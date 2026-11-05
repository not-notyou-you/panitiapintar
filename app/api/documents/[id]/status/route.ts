import type { NextRequest } from "next/server";
import { handleStatus } from "@/lib/api/documents";
import { routeDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";
import { serviceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRequestLog<Ctx>(
  "GET /api/documents/[id]/status",
  async (_req: NextRequest, log, ctx, requestId) =>
    handleStatus((await ctx.params).id, { ...(await routeDeps(log, requestId)), svc: serviceClient() }),
);
