import type { NextRequest } from "next/server";
import { handleQr } from "@/lib/api/qr";
import { routeDeps } from "@/lib/api/route-deps";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withRequestLog<Ctx>("GET /api/qr/[slug]", async (req: NextRequest, log, ctx, requestId) =>
  handleQr((await ctx.params).slug, req.nextUrl.searchParams, await routeDeps(log, requestId)),
);
