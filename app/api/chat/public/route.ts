import { NextResponse, type NextRequest } from "next/server";
import { aiClient } from "@/lib/ai/client";
import { saveChatLog } from "@/lib/chat/chat-log";
import { handlePublicChat, type HandlerResult } from "@/lib/chat/public-chat";
import { findPublicCommittee, loadPublicContext, PublicDataUnavailableError } from "@/lib/context/public";
import { env } from "@/lib/env";
import { errorBody, type ErrorCode } from "@/lib/http/errors";
import { audit } from "@/lib/log/audit";
import { withRequestLog } from "@/lib/log/with-request-log";
import { clientIp, ipHash } from "@/lib/privacy/ip-hash";
import { rateLimit, RateLimitUnavailableError } from "@/lib/rate-limit";
import { publicChatRequestSchema } from "@/lib/validation/chat";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024; // SEC-07

function json(result: HandlerResult): NextResponse {
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

function error(code: ErrorCode, status: number, requestId: string): NextResponse {
  return NextResponse.json(errorBody(code, requestId), { status });
}

// ARCHITECTURE.md §5.1. Step 1 (requestId, headers) happens in middleware/withRequestLog.
export const POST = withRequestLog("POST /api/chat/public", async (req: NextRequest, log, _ctx, requestId) => {
  // SEC-11: browsers always send Origin on POST; reject foreign ones.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(env().APP_URL).origin) {
    log.warn({ event: "security.csrf.blocked", origin }, "foreign origin");
    return error("FORBIDDEN", 403, requestId);
  }

  // 2. Size limit, then zod.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return error("PAYLOAD_TOO_LARGE", 413, requestId);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return error("PAYLOAD_TOO_LARGE", 413, requestId);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error("INVALID_INPUT", 400, requestId);
  }
  const parsed = publicChatRequestSchema.safeParse(body);
  if (!parsed.success) return error("INVALID_INPUT", 400, requestId);

  try {
    const result = await handlePublicChat(parsed.data, {
      log,
      requestId,
      ipHash: ipHash(clientIp(req.headers)),
      rateLimit: (bucket, key) => rateLimit(bucket, key, { log }),
      findCommittee: findPublicCommittee,
      loadContext: loadPublicContext,
      generate: (input) => aiClient().generate(input),
      saveChatLog,
      audit: (entry) => audit(entry, { log }),
    });
    return json(result);
  } catch (err) {
    if (err instanceof PublicDataUnavailableError || err instanceof RateLimitUnavailableError) {
      log.error({ event: "http.request.failed", status: 503, error: { code: err.name } }, "dependency down");
      return error("SERVICE_UNAVAILABLE", 503, requestId);
    }
    throw err;
  }
});
