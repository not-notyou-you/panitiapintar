import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { audit } from "@/lib/log/audit";
import { withRequestLog } from "@/lib/log/with-request-log";
import { serverClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";

const OTP_TYPES = new Set(["magiclink", "invite", "email"]);

// Magic link landing: PKCE `code` (signInWithOtp) or `token_hash` (invite e-mails). Redirects only
// to same-site paths via safeNextPath (no open redirect).
export const GET = withRequestLog("GET /auth/callback", async (req: NextRequest, log, _ctx, requestId) => {
  const origin = new URL(env().APP_URL).origin;
  const params = req.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const supabase = await serverClient();

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") ?? "";
  let userId: string | undefined;
  let reason = "missing_code";
  if (code && code.length <= 512) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    userId = data.user?.id;
    reason = error?.code ?? "exchange_failed";
  } else if (tokenHash && tokenHash.length <= 512 && OTP_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "magiclink" | "invite" | "email",
    });
    userId = data.user?.id;
    reason = error?.code ?? "verify_failed";
  }

  if (!userId) {
    log.warn({ event: "auth.login.failed", reason }, "login failed");
    return NextResponse.redirect(`${origin}/login?error=link`, 303);
  }
  log.info({ event: "auth.login.succeeded", userId }, "login succeeded");
  await audit(
    {
      action: "auth.login",
      actorId: userId,
      actorRole: "member",
      targetType: "system",
      outcome: "success",
      metadata: { method: "magic_link" },
      requestId,
    },
    { log },
  );
  return NextResponse.redirect(`${origin}${next}`, 303);
});
