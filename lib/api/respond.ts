import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Logger } from "pino";
import { toErrorBody } from "@/lib/actions/runtime";
import type { GuardDeps } from "@/lib/auth/guards";
import { AppError, ERROR_STATUS } from "@/lib/http/errors";
import type { AuditEntry } from "@/lib/log/audit-schema";

/** Dependencies of a phase-2 route handler. `client` carries the user's JWT; `svc` is for pipeline work only. */
export interface RouteDeps {
  client: SupabaseClient;
  log: Logger;
  requestId: string;
  appUrl: string;
  audit: (entry: AuditEntry) => Promise<void>;
}

export function routeGuard(deps: RouteDeps, route: string): GuardDeps {
  return { client: deps.client, log: deps.log, route, requestId: deps.requestId, audit: deps.audit };
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMITED", "Batas permintaan tercapai. Coba lagi nanti.");
  }
}

/** Runs a handler body; AppErrors become the uniform error JSON (API.md §1), anything else a generic 500. */
export async function respond(deps: RouteDeps, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const body = toErrorBody(err, deps.log, deps.requestId);
    const headers: Record<string, string> = {};
    if (err instanceof RateLimitedError) headers["Retry-After"] = String(err.retryAfterSeconds);
    return NextResponse.json({ error: body }, { status: ERROR_STATUS[body.code], headers });
  }
}

export interface DocumentRow {
  id: string;
  committee_id: string;
  title: string;
  status: string;
  visibility: "internal" | "public";
  version: number;
  current_version_id: string | null;
  status_reason: string | null;
  pii_summary: Record<string, number>;
  storage_path: string;
  updated_at: string;
}

export const DOCUMENT_COLUMNS =
  "id, committee_id, title, status, visibility, version, current_version_id, status_reason, pii_summary, storage_path, updated_at";

/**
 * Reads a document with the user's JWT. RLS hides documents of other committees, so a foreign id
 * looks exactly like a missing one (404, no existence leak). Membership is still checked afterwards.
 */
export async function loadDocument(
  client: SupabaseClient,
  documentId: string,
  log: Logger,
): Promise<DocumentRow> {
  const { data, error } = await client
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .maybeSingle();
  if (error && error.code !== "22P02") throw new Error(`document read failed: ${error.code}`);
  if (!data) {
    log.warn({ event: "auth.access.denied", route: "document", required: "member" }, "document not visible");
    throw new AppError("NOT_FOUND", "Dokumen tidak ditemukan.");
  }
  return data as DocumentRow;
}
