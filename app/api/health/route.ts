import { handleHealth, pingWithAnon } from "@/lib/api/system";
import { withRequestLog } from "@/lib/log/with-request-log";
import { anonClient } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reads process.env directly: health must answer even when lib/env.ts would refuse to start.
export const GET = withRequestLog("GET /api/health", (_req, log) =>
  handleHealth({
    log,
    pingDb: () => pingWithAnon(anonClient()),
    aiConfigured: process.env.AI_MOCK === "true" || !!process.env.GEMINI_API_KEY?.trim(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.npm_package_version ?? "dev",
  }),
);
