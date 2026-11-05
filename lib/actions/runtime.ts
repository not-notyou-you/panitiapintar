import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { z } from "zod";
import type { GuardDeps } from "@/lib/auth/guards";
import { AppError, ERROR_MESSAGES, type ErrorCode } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { AuditWriteError } from "@/lib/log/audit";
import type { AuditEntry } from "@/lib/log/audit-schema";

/** Everything an action needs from the request. Built by server-ctx.ts in Next, by helpers in tests. */
export interface ActionCtx {
  client: SupabaseClient;
  requestId: string;
  log: Logger;
  origin: string | null;
  appUrl: string;
  audit: (entry: AuditEntry) => Promise<void>;
}

export type ActionResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: ErrorCode; message: string; requestId: string } };

export function guardDeps(ctx: ActionCtx, route: string): GuardDeps {
  return { client: ctx.client, log: ctx.log, route, requestId: ctx.requestId, audit: ctx.audit };
}

/**
 * Shared boundary for every server action: SEC-11 origin check, zod validation (rule 5), then `fn`.
 * Errors become a generic { code, message, requestId } (rule 8); details stay in the server log.
 */
export async function runAction<S extends z.ZodType, T>(
  name: string,
  ctx: ActionCtx,
  schema: S,
  raw: unknown,
  fn: (input: z.infer<S>, g: GuardDeps) => Promise<T>,
): Promise<ActionResult<T>> {
  const log = ctx.log.child({ route: `action:${name}` });
  const c = { ...ctx, log };
  try {
    assertSameOrigin(ctx.origin, ctx.appUrl, log);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT", "Isian tidak valid. Periksa kembali.");
    const data = await fn(parsed.data, guardDeps(c, `action:${name}`));
    return { ok: true, data, requestId: ctx.requestId };
  } catch (err) {
    return { ok: false, error: toErrorBody(err, log, ctx.requestId) };
  }
}

export function toErrorBody(err: unknown, log: Logger, requestId: string) {
  if (err instanceof AppError) {
    return { code: err.code, message: err.userMessage ?? ERROR_MESSAGES[err.code], requestId };
  }
  const code = err instanceof AuditWriteError ? "audit_write_failed" : err instanceof Error ? err.name : "unknown";
  log.error({ event: "http.request.failed", status: 500, error: { code }, err }, "action failed");
  return { code: "INTERNAL" as const, message: ERROR_MESSAGES.INTERNAL, requestId };
}

// API.md §2 "Pemetaan error RPC → HTTP". Messages are fixed strings keyed by the DB error text.
const INVALID_MESSAGES: Record<string, string> = {
  not_approved: "Setujui dokumen dulu sebelum dijadikan Publik.",
  pii_present: "Masih ada data pribadi di versi ini. Redaksi dulu sebelum dijadikan Publik.",
  invalid_transition: "Status dokumen tidak mengizinkan aksi ini.",
  invalid_version: "Versi dokumen tidak valid.",
  invalid_reason: "Alasan penolakan tidak valid.",
  invalid_request_id: "Permintaan tidak valid.",
};

/** Turns a PostgREST/RPC error into an AppError. Unknown errors are rethrown as INTERNAL. */
export function dbError(error: PostgrestError | { code?: string; message?: string }): AppError {
  const msg = error.message ?? "";
  switch (error.code) {
    case "40001":
      return new AppError("CONFLICT");
    case "42501":
      return new AppError("FORBIDDEN");
    case "P0002":
      return new AppError("NOT_FOUND", "Data tidak ditemukan.");
    case "22023":
      return new AppError("INVALID_INPUT", INVALID_MESSAGES[msg] ?? "Permintaan tidak valid.");
    case "23514":
      if (msg.includes("last_admin")) {
        return new AppError("CONFLICT", "Kepanitiaan harus punya minimal satu admin.");
      }
      return new AppError("INVALID_INPUT", "Isian tidak valid. Periksa kembali.");
    case "23505":
      return new AppError("CONFLICT", "Data yang sama sudah ada.");
    default: {
      const e = new Error(`db error ${error.code ?? "unknown"}`);
      e.name = `DbError_${error.code ?? "unknown"}`;
      throw e;
    }
  }
}
