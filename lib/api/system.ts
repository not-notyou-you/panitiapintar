import "server-only";
// System endpoints: GET /api/health and GET /api/cron/retention (API.md §2, LOGGING §9).
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Logger } from "pino";
import { errorBody } from "@/lib/http/errors";
import { audit as writeAudit } from "@/lib/log/audit";

export const HEALTH_DB_TIMEOUT_MS = 3000;
export const RETENTION_DAYS = { chat: 30, ai: 90, audit: 180 } as const;

export interface HealthDeps {
  log: Logger;
  pingDb: () => Promise<boolean>;
  aiConfigured: boolean;
  version: string;
}

/** Never calls Gemini (quota). DB down or AI key missing → degraded + 503 so monitors notice. */
export async function handleHealth(deps: HealthDeps): Promise<Response> {
  let dbUp = false;
  try {
    dbUp = await Promise.race([
      deps.pingDb(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), HEALTH_DB_TIMEOUT_MS)),
    ]);
  } catch {
    dbUp = false;
  }
  const db = dbUp ? "up" : "down";
  const ai = deps.aiConfigured ? "configured" : "missing";
  const status = dbUp && deps.aiConfigured ? "ok" : "degraded";
  if (status === "degraded") deps.log.warn({ event: "health.check.degraded", db, ai }, "health degraded");
  return NextResponse.json(
    { status, db, ai, version: deps.version },
    { status: status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

/** Anon-key ping: committees is readable by anon (active rows), so this needs no service role. */
export async function pingWithAnon(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from("committees").select("id").limit(1);
  return !error;
}

/** Compares hashes so the check takes the same time whatever the input length. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ") || secret.length === 0) return false;
  const a = createHash("sha256").update(header.slice(7)).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export interface RetentionDeps {
  log: Logger;
  requestId: string;
  secret: string;
  /** Service role: purge_expired_logs is granted to service_role only (system task, CLAUDE.md rule 4). */
  svc: SupabaseClient;
  audit?: typeof writeAudit;
}

export async function handleRetention(req: Request, deps: RetentionDeps): Promise<Response> {
  const { log, requestId } = deps;
  if (!bearerMatches(req.headers.get("authorization"), deps.secret)) {
    log.warn(
      { event: "auth.access.denied", route: "GET /api/cron/retention", required: "super_admin" },
      "cron denied",
    );
    return NextResponse.json(errorBody("UNAUTHENTICATED", requestId), { status: 401 });
  }
  const { data, error } = await deps.svc.rpc("purge_expired_logs", {
    p_chat_days: RETENTION_DAYS.chat,
    p_ai_days: RETENTION_DAYS.ai,
    p_audit_days: RETENTION_DAYS.audit,
  });
  if (error) {
    log.error(
      { event: "retention.purge.failed", error: { code: error.code ?? "unknown" } },
      "retention failed",
    );
    return NextResponse.json(errorBody("SERVICE_UNAVAILABLE", requestId), { status: 503 });
  }
  const counts = (data ?? {}) as Record<string, number>;
  log.info({ event: "retention.purge.completed", ...counts }, "retention completed");
  await (deps.audit ?? writeAudit)(
    {
      action: "system.retention_purge",
      actorId: null,
      actorRole: "system",
      targetType: "system",
      outcome: "success",
      metadata: counts,
      requestId,
    },
    { log, client: deps.svc },
  );
  return NextResponse.json({ purged: counts, requestId });
}
