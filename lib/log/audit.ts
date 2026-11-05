import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { redactDeep } from "@/lib/privacy";
import { serviceClient } from "@/lib/supabase/service";
import { CRITICAL_AUDIT_ACTIONS, auditEntrySchema, type AuditEntry } from "./audit-schema";
import { logger } from "./logger";

export class AuditWriteError extends Error {
  constructor(readonly action: string) {
    super(`audit write failed: ${action}`);
    this.name = "AuditWriteError";
  }
}

export interface AuditDeps {
  client?: SupabaseClient;
  log?: Logger;
}

/**
 * Writes an audit_logs row with the service role. Failures are logged and swallowed,
 * except for critical actions, which throw AuditWriteError so the caller aborts.
 */
export async function audit(entry: AuditEntry, deps: AuditDeps = {}): Promise<void> {
  const log = deps.log ?? logger;
  const e = auditEntrySchema.parse(entry);
  const { error } = await (deps.client ?? serviceClient()).from("audit_logs").insert({
    actor_id: e.actorId,
    actor_role: e.actorRole,
    action: e.action,
    target_type: e.targetType,
    target_id: e.targetId,
    committee_id: e.committeeId,
    outcome: e.outcome,
    metadata: redactDeep(e.metadata),
    request_id: e.requestId,
    ip_hash: e.ipHash,
  });
  if (!error) return;
  log.error(
    { event: "audit.write.failed", action: e.action, error: { code: error.code } },
    "audit write failed",
  );
  if (CRITICAL_AUDIT_ACTIONS.has(e.action)) throw new AuditWriteError(e.action);
}
