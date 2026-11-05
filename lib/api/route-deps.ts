import "server-only";
import { after } from "next/server";
import type { Logger } from "pino";
import { aiClient } from "@/lib/ai/client";
import { saveChatLog } from "@/lib/chat/chat-log";
import { refineDocument } from "@/lib/documents/pipeline";
import { env } from "@/lib/env";
import { audit } from "@/lib/log/audit";
import { rateLimit } from "@/lib/rate-limit";
import { serverClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import type { UploadDeps } from "./documents";
import type { PanitiaDeps } from "./panitia";
import type { RouteDeps } from "./respond";

export async function routeDeps(log: Logger, requestId: string): Promise<RouteDeps> {
  return {
    client: await serverClient(),
    log,
    requestId,
    appUrl: env().APP_URL,
    audit: (entry) => audit(entry, { log }),
  };
}

/** Adds the pipeline pieces. Refine runs after the response is sent (Vercel keeps the function alive). */
export async function pipelineDeps(log: Logger, requestId: string): Promise<UploadDeps> {
  const svc = serviceClient();
  return {
    ...(await routeDeps(log, requestId)),
    svc,
    rateLimit: (bucket, key) => rateLimit(bucket, key, { log }),
    schedule: (documentId) =>
      after(async () => {
        await refineDocument(documentId, { svc, log, requestId, generate: (i) => aiClient().generate(i) });
      }),
  };
}

/** Mode Panitia: user-JWT client for context, shared AI client, chat_logs writer. */
export async function panitiaDeps(log: Logger, requestId: string): Promise<PanitiaDeps> {
  return {
    ...(await routeDeps(log, requestId)),
    rateLimit: (bucket, key) => rateLimit(bucket, key, { log }),
    generate: (input) => aiClient().generate(input),
    saveChatLog,
  };
}
