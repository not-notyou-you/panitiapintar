import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMembership } from "@/lib/auth/guards";
import { AppError } from "@/lib/http/errors";
import { emailHash } from "@/lib/privacy/ip-hash";
import { changeMemberRoleSchema, inviteMemberSchema, removeMemberSchema } from "@/lib/validation/admin";
import { dbError, runAction, type ActionCtx } from "./runtime";

// FR-A5. Emails are never logged raw (SEC-12): logs carry emailHash, audit rows carry the role only.

/**
 * Finds an auth user, or creates one with a temporary password (no e-mail is sent). Auth Admin API
 * requires the service role (SECURITY.md, K3). The temporary password goes back to the inviting admin
 * once, in the action result only: it is never logged, audited or stored outside Supabase Auth.
 */
export type FindOrInvite = (
  email: string,
) => Promise<{ userId: string; invited: boolean; tempPassword?: string }>;

/** 16 chars from a 56-char alphabet without look-alikes (0/O, 1/l/I): ~93 bits. */
export function tempPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function serviceFindOrInvite(svc: SupabaseClient): FindOrInvite {
  return async (email) => {
    const { data: found, error } = await svc.rpc("find_user_id_by_email", { p_email: email });
    if (error) throw new Error(`user lookup failed: ${error.code}`);
    if (found) return { userId: found as string, invited: false };
    const password = tempPassword();
    const { data, error: createErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !data.user) throw new Error(`create user failed: ${createErr?.code ?? "no_user"}`);
    return { userId: data.user.id, invited: true, tempPassword: password };
  };
}

async function adminCount(client: SupabaseClient, committeeId: string): Promise<number> {
  const { count, error } = await client
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("committee_id", committeeId)
    .eq("role", "admin");
  if (error) throw dbError(error);
  return count ?? 0;
}

async function currentRole(client: SupabaseClient, committeeId: string, userId: string) {
  const { data, error } = await client
    .from("memberships")
    .select("role")
    .eq("committee_id", committeeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw new AppError("NOT_FOUND", "Anggota tidak ditemukan.");
  return data.role as "admin" | "member";
}

const LAST_ADMIN = "Kepanitiaan harus punya minimal satu admin.";

export function inviteMember(raw: unknown, ctx: ActionCtx, findOrInvite: FindOrInvite) {
  return runAction("inviteMember", ctx, inviteMemberSchema, raw, async (input, g) => {
    const actor = await requireMembership(input.committeeId, "admin", g);
    // Guard first: the service-role lookup/invite only ever runs for a verified committee admin.
    const { userId, invited, tempPassword: password } = await findOrInvite(input.email);
    const { error } = await ctx.client
      .from("memberships")
      .insert({ user_id: userId, committee_id: input.committeeId, role: input.role });
    if (error) {
      if (error.code === "23505") throw new AppError("CONFLICT", "Orang ini sudah menjadi anggota.");
      throw dbError(error);
    }
    ctx.log.info(
      {
        event: "membership.invited",
        committeeId: input.committeeId,
        emailHash: emailHash(input.email),
        role: input.role,
        invited,
      },
      "member invited",
    );
    await ctx.audit({
      action: "membership.add",
      actorId: actor.userId,
      actorRole: actor.actorRole,
      targetType: "membership",
      targetId: userId,
      committeeId: input.committeeId,
      outcome: "success",
      metadata: { role: input.role },
      requestId: ctx.requestId,
    });
    return password ? { userId, invited, tempPassword: password } : { userId, invited };
  });
}

export function changeMemberRole(raw: unknown, ctx: ActionCtx) {
  return runAction("changeMemberRole", ctx, changeMemberRoleSchema, raw, async (input, g) => {
    const actor = await requireMembership(input.committeeId, "admin", g);
    const from = await currentRole(ctx.client, input.committeeId, input.userId);
    if (from === input.role) return { role: from };
    if (from === "admin" && (await adminCount(ctx.client, input.committeeId)) <= 1) {
      throw new AppError("CONFLICT", LAST_ADMIN);
    }
    const { data, error } = await ctx.client
      .from("memberships")
      .update({ role: input.role })
      .eq("committee_id", input.committeeId)
      .eq("user_id", input.userId)
      .select("user_id");
    if (error) throw dbError(error);
    if ((data ?? []).length !== 1) throw new AppError("FORBIDDEN");
    ctx.log.info({ event: "membership.role_changed", committeeId: input.committeeId }, "role changed");
    await ctx.audit({
      action: "membership.role_change",
      actorId: actor.userId,
      actorRole: actor.actorRole,
      targetType: "membership",
      targetId: input.userId,
      committeeId: input.committeeId,
      outcome: "success",
      metadata: { from, to: input.role },
      requestId: ctx.requestId,
    });
    return { role: input.role };
  });
}

export function removeMember(raw: unknown, ctx: ActionCtx) {
  return runAction("removeMember", ctx, removeMemberSchema, raw, async (input, g) => {
    const actor = await requireMembership(input.committeeId, "admin", g);
    const role = await currentRole(ctx.client, input.committeeId, input.userId);
    if (role === "admin" && (await adminCount(ctx.client, input.committeeId)) <= 1) {
      throw new AppError("CONFLICT", LAST_ADMIN);
    }
    const { data, error } = await ctx.client
      .from("memberships")
      .delete()
      .eq("committee_id", input.committeeId)
      .eq("user_id", input.userId)
      .select("user_id");
    if (error) throw dbError(error);
    if ((data ?? []).length !== 1) throw new AppError("FORBIDDEN");
    ctx.log.info({ event: "membership.removed", committeeId: input.committeeId }, "member removed");
    await ctx.audit({
      action: "membership.remove",
      actorId: actor.userId,
      actorRole: actor.actorRole,
      targetType: "membership",
      targetId: input.userId,
      committeeId: input.committeeId,
      outcome: "success",
      metadata: { role },
      requestId: ctx.requestId,
    });
    return { userId: input.userId };
  });
}
