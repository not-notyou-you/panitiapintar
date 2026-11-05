import "server-only";
import { AppError } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { emailHash } from "@/lib/privacy/ip-hash";
import { rateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { magicLinkSchema, safeNextPath } from "@/lib/validation/admin";
import { toErrorBody, type ActionCtx, type ActionResult } from "./runtime";

export const MAGIC_LINK_SENT = "Jika email terdaftar sebagai panitia, tautan masuk sudah dikirim. Periksa kotak masuk.";

export interface MagicLinkDeps {
  ipHash: string;
  rateLimit?: (key: string) => Promise<RateLimitResult>;
}

/**
 * Sends a magic link to existing accounts only (shouldCreateUser: false). The reply is identical
 * whether or not the email exists, so the form cannot be used to enumerate committee members.
 */
export async function requestMagicLink(
  raw: unknown,
  ctx: ActionCtx,
  deps: MagicLinkDeps,
): Promise<ActionResult<{ message: string }>> {
  const log = ctx.log.child({ route: "action:requestMagicLink" });
  try {
    assertSameOrigin(ctx.origin, ctx.appUrl, log);
    const parsed = magicLinkSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT", "Masukkan alamat email yang valid.");
    const hash = emailHash(parsed.data.email);
    const limit = deps.rateLimit ?? ((key: string) => rateLimit("login", key, { log }));
    for (const key of [`ip:${deps.ipHash}`, `email:${hash}`]) {
      const r = await limit(key);
      if (!r.ok) throw new AppError("RATE_LIMITED", "Terlalu banyak permintaan masuk. Coba lagi nanti.");
    }

    const next = safeNextPath(parsed.data.next);
    const redirectTo = `${new URL(ctx.appUrl).origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await ctx.client.auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    log.info({ event: "auth.magiclink.requested", emailHash: hash }, "magic link requested");
    // Unknown emails error out with shouldCreateUser=false; the user still sees the same message.
    if (error) log.warn({ event: "auth.login.failed", reason: error.code ?? "otp_error" }, "otp not sent");
    return { ok: true, data: { message: MAGIC_LINK_SENT }, requestId: ctx.requestId };
  } catch (err) {
    return { ok: false, error: toErrorBody(err, log, ctx.requestId) };
  }
}
