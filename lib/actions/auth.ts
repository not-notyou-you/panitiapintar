import "server-only";
import { AppError } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { emailHash } from "@/lib/privacy/ip-hash";
import { rateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { changePasswordSchema, loginSchema, safeNextPath } from "@/lib/validation/admin";
import { requireUser } from "@/lib/auth/guards";
import { toErrorBody, type ActionCtx, type ActionResult } from "./runtime";

/** One message for wrong email, wrong password and unknown account: no member enumeration. */
export const LOGIN_FAILED = "Email atau kata sandi salah.";

export interface LoginDeps {
  ipHash: string;
  rateLimit?: (key: string) => Promise<RateLimitResult>;
}

/**
 * Email + password sign-in. The session cookie is set by ctx.client (user JWT server client).
 * Rate limited per IP-hash and email-hash before Supabase is called (SEC-07); the password is never
 * logged and the email only as a hash (SEC-12).
 */
export async function signInWithPassword(
  raw: unknown,
  ctx: ActionCtx,
  deps: LoginDeps,
): Promise<ActionResult<{ next: string }>> {
  const log = ctx.log.child({ route: "action:signInWithPassword" });
  try {
    assertSameOrigin(ctx.origin, ctx.appUrl, log);
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT", "Masukkan email dan kata sandi.");
    const hash = emailHash(parsed.data.email);
    const limit = deps.rateLimit ?? ((key: string) => rateLimit("login", key, { log }));
    for (const key of [`ip:${deps.ipHash}`, `email:${hash}`]) {
      const r = await limit(key);
      if (!r.ok) throw new AppError("RATE_LIMITED", "Terlalu banyak percobaan masuk. Coba lagi nanti.");
    }

    const { data, error } = await ctx.client.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user) {
      log.warn({ event: "auth.login.failed", reason: error?.code ?? "no_user" }, "login failed");
      throw new AppError("UNAUTHENTICATED", LOGIN_FAILED);
    }
    const userId = data.user.id;
    log.info({ event: "auth.login.succeeded", userId }, "login succeeded");
    await ctx.audit({
      action: "auth.login",
      actorId: userId,
      actorRole: "member",
      targetType: "system",
      outcome: "success",
      metadata: { method: "password" },
      requestId: ctx.requestId,
    });
    return { ok: true, data: { next: safeNextPath(parsed.data.next) }, requestId: ctx.requestId };
  } catch (err) {
    return { ok: false, error: toErrorBody(err, log, ctx.requestId) };
  }
}

/**
 * Lets a signed-in user replace their (temporary) password. The current password is re-checked first,
 * so a borrowed open session cannot lock the owner out. Passwords are never logged.
 */
export async function changePassword(
  raw: unknown,
  ctx: ActionCtx,
  deps: LoginDeps,
): Promise<ActionResult<{ message: string }>> {
  const log = ctx.log.child({ route: "action:changePassword" });
  try {
    assertSameOrigin(ctx.origin, ctx.appUrl, log);
    const parsed = changePasswordSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Input tidak valid.");
    const user = await requireUser({
      client: ctx.client,
      log,
      route: "action:changePassword",
      requestId: ctx.requestId,
      audit: ctx.audit,
    });
    const limit = deps.rateLimit ?? ((key: string) => rateLimit("login", key, { log }));
    const r = await limit(`user:${user.userId}`);
    if (!r.ok) throw new AppError("RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi nanti.");

    const { data: me } = await ctx.client.auth.getUser();
    const email = me.user?.email;
    const check = email
      ? await ctx.client.auth.signInWithPassword({ email, password: parsed.data.currentPassword })
      : null;
    if (!check || check.error) {
      log.warn({ event: "auth.login.failed", reason: "wrong_current_password" }, "password change denied");
      throw new AppError("INVALID_INPUT", "Kata sandi saat ini salah.");
    }
    if (parsed.data.newPassword === parsed.data.currentPassword)
      throw new AppError("INVALID_INPUT", "Kata sandi baru harus berbeda.");
    const { error } = await ctx.client.auth.updateUser({ password: parsed.data.newPassword });
    if (error) {
      log.warn({ event: "auth.password.change_failed", reason: error.code ?? "update_failed" }, "update failed");
      throw new AppError("INVALID_INPUT", "Kata sandi baru ditolak. Coba kata sandi lain yang lebih kuat.");
    }
    log.info({ event: "auth.password.changed", userId: user.userId }, "password changed");
    await ctx.audit({
      action: "auth.password.changed",
      actorId: user.userId,
      actorRole: "member",
      targetType: "system",
      outcome: "success",
      metadata: {},
      requestId: ctx.requestId,
    });
    return { ok: true, data: { message: "Kata sandi berhasil diganti." }, requestId: ctx.requestId };
  } catch (err) {
    return { ok: false, error: toErrorBody(err, log, ctx.requestId) };
  }
}
