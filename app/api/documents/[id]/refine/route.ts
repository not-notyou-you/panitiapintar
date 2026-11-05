import type { NextRequest } from "next/server";
import { handleRefineRetry } from "@/lib/api/documents";
import { pipelineDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRequestLog<Ctx>(
  "POST /api/documents/[id]/refine",
  async (req: NextRequest, log, ctx, requestId) =>
    handleRefineRetry(req, (await ctx.params).id, await pipelineDeps(log, requestId)),
);
