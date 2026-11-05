import type { NextRequest } from "next/server";
import { handleRetention } from "@/lib/api/system";
import { env } from "@/lib/env";
import { withRequestLog } from "@/lib/log/with-request-log";
import { serviceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vercel Cron (vercel.json) calls this daily with Authorization: Bearer ${CRON_SECRET}.
export const GET = withRequestLog("GET /api/cron/retention", (req: NextRequest, log, _ctx, requestId) =>
  handleRetention(req, { log, requestId, secret: env().CRON_SECRET, svc: serviceClient() }),
);
