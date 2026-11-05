import type { NextRequest } from "next/server";
import { handleLogExport } from "@/lib/api/admin-logs";
import { routeDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withRequestLog(
  "GET /api/admin/logs/export",
  async (req: NextRequest, log, _ctx, requestId) =>
    handleLogExport(req.nextUrl.searchParams, await routeDeps(log, requestId)),
);
