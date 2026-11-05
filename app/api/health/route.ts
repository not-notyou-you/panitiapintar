import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/log/with-request-log";

export const dynamic = "force-dynamic";

export const GET = withRequestLog("GET /api/health", () => NextResponse.json({ status: "ok" }));
