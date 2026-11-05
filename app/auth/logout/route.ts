import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { AppError, errorBody } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { withRequestLog } from "@/lib/log/with-request-log";
import { serverClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// SEC-11: POST only, same origin. signOut() revokes the refresh token on the server, not just the cookie.
export const POST = withRequestLog("POST /auth/logout", async (req: NextRequest, log, _ctx, requestId) => {
  try {
    assertSameOrigin(req.headers.get("origin"), env().APP_URL, log);
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(errorBody("FORBIDDEN", requestId), { status: 403 });
    throw err;
  }
  const supabase = await serverClient();
  const { data } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  if (data.user) log.info({ event: "auth.logout.completed", userId: data.user.id }, "logout");
  return NextResponse.redirect(`${new URL(env().APP_URL).origin}/login`, 303);
});
