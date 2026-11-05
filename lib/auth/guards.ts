import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { z } from "zod";
import { AppError } from "@/lib/http/errors";
import type { AuditEntry } from "@/lib/log/audit-schema";

// SEC-03 layer 2. Every route handler and server action calls one of these before touching data.
// The client carries the user's JWT, so RLS (layer 3) still applies to whatever the caller does next.

export type RequiredRole = "member" | "admin" | "super_admin";
export type ActorRole = "super_admin" | "admin" | "member";

export interface GuardDeps {
  client: SupabaseClient;
  log: Logger;
  route: string;
  requestId: string;
  /** Writes audit rows for denials. Injected so guards stay testable. */
  audit: (entry: AuditEntry) => Promise<void>;
}

export interface UserContext {
  userId: string;
  isSuperAdmin: boolean;
  client: SupabaseClient;
}

export interface MembershipContext extends UserContext {
  committeeId: string;
  /** Role used for audit rows: super admins act as super_admin even when also a member. */
  actorRole: ActorRole;
}

const uuid = z.uuid();

/** Verifies the session with Supabase Auth (getUser validates the JWT server-side, unlike getSession). */
export async function requireUser(deps: GuardDeps): Promise<UserContext> {
  const { data, error } = await deps.client.auth.getUser();
  const userId = data?.user?.id;
  if (error || !userId) {
    deps.log.warn({ event: "auth.access.denied", route: deps.route, required: "member" }, "unauthenticated");
    throw new AppError("UNAUTHENTICATED");
  }
  const { data: profile } = await deps.client
    .from("profiles")
    .select("is_super_admin")
    .eq("user_id", userId)
    .maybeSingle();
  return { userId, isSuperAdmin: profile?.is_super_admin === true, client: deps.client };
}

export async function requireRole(role: "super_admin", deps: GuardDeps): Promise<UserContext> {
  const user = await requireUser(deps);
  if (!user.isSuperAdmin) {
    await deny(deps, { userId: user.userId, required: role, committeeId: null });
  }
  return user;
}

/**
 * The committee id comes from the URL or body and is never trusted: membership is re-read here.
 * Super admins pass every membership check unless `realMemberOnly` is set (Mode Panitia: internal
 * documents are for actual committee members only). Unknown/invalid ids are denied like foreign ones.
 */
export async function requireMembership(
  committeeId: string,
  role: "admin" | "member" | undefined,
  deps: GuardDeps,
  opts: { realMemberOnly?: boolean } = {},
): Promise<MembershipContext> {
  const user = await requireUser(deps);
  const required: RequiredRole = role ?? "member";
  if (!uuid.safeParse(committeeId).success) {
    await deny(deps, { userId: user.userId, required, committeeId: null });
  }
  if (user.isSuperAdmin && !opts.realMemberOnly) return { ...user, committeeId, actorRole: "super_admin" };

  const { data } = await deps.client
    .from("memberships")
    .select("role")
    .eq("user_id", user.userId)
    .eq("committee_id", committeeId)
    .maybeSingle();
  const has = data?.role as "admin" | "member" | undefined;
  if (!has || (required === "admin" && has !== "admin")) {
    await deny(deps, { userId: user.userId, required, committeeId });
  }
  return { ...user, committeeId, actorRole: user.isSuperAdmin ? "super_admin" : (has as ActorRole) };
}

async function deny(
  deps: GuardDeps,
  d: { userId: string; required: RequiredRole; committeeId: string | null },
): Promise<never> {
  deps.log.warn(
    {
      event: "auth.access.denied",
      userId: d.userId,
      route: deps.route,
      required: d.required,
      committeeId: d.committeeId ?? undefined,
    },
    "access denied",
  );
  await deps.audit({
    action: "auth.access_denied",
    actorId: d.userId,
    actorRole: "member",
    targetType: d.committeeId ? "committee" : "system",
    targetId: d.committeeId,
    committeeId: d.committeeId,
    outcome: "denied",
    metadata: { required: d.required, route: deps.route },
    requestId: deps.requestId,
  });
  throw new AppError("FORBIDDEN");
}
