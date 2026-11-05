import { z } from "zod";

// LOGGING.md §6.
export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.access_denied",
  "committee.create",
  "committee.update",
  "committee.archive",
  "membership.add",
  "membership.role_change",
  "membership.remove",
  "document.upload",
  "document.approve",
  "document.reject",
  "document.edit_after_approve",
  "document.visibility.changed",
  "document.delete",
  "document.raw_download",
  "security.canary_leaked",
  "system.retention_purge",
  "config.key.rotated",
] as const;

/** Actions whose audit write must succeed, otherwise the action itself is cancelled (LOGGING §7). */
export const CRITICAL_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "document.approve",
  "document.visibility.changed",
]);

export const auditEntrySchema = z.object({
  action: z.enum(AUDIT_ACTIONS),
  actorId: z.uuid().nullable(),
  actorRole: z.enum(["super_admin", "admin", "member", "system"]),
  targetType: z.enum(["committee", "document", "membership", "system"]),
  targetId: z.string().max(100).nullable().default(null),
  committeeId: z.uuid().nullable().default(null),
  outcome: z.enum(["success", "denied", "failure"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  requestId: z.string().max(40).nullable().default(null),
  ipHash: z.string().max(128).nullable().default(null),
});

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditEntry = z.input<typeof auditEntrySchema>;
