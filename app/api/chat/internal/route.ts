import type { NextRequest } from "next/server";
import { handleInternalChat } from "@/lib/api/panitia";
import { panitiaDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withRequestLog(
  "POST /api/chat/internal",
  async (req: NextRequest, log, _ctx, requestId) =>
    handleInternalChat(req, await panitiaDeps(log, requestId)),
);
