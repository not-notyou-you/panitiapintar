import type { NextRequest } from "next/server";
import { handleUpload } from "@/lib/api/documents";
import { pipelineDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Extraction (≤30 s) runs inline; refine runs in after() and needs the rest of the budget.
export const maxDuration = 60;

export const POST = withRequestLog(
  "POST /api/documents/upload",
  async (req: NextRequest, log, _ctx, requestId) => handleUpload(req, await pipelineDeps(log, requestId)),
);
