import type { NextRequest } from "next/server";
import { handleGenerate } from "@/lib/api/panitia";
import { panitiaDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ kind: string }> };

export const POST = withRequestLog<Ctx>(
  "POST /api/generate/[kind]",
  async (req: NextRequest, log, ctx, requestId) =>
    handleGenerate((await ctx.params).kind, req, await panitiaDeps(log, requestId)),
);
