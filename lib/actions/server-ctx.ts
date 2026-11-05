import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { audit } from "@/lib/log/audit";
import { withRequest } from "@/lib/log/logger";
import { REQUEST_ID_HEADER, isValidRequestId, newRequestId } from "@/lib/log/request-id";
import { serverClient } from "@/lib/supabase/server";
import type { ActionCtx } from "./runtime";

/** ActionCtx for a Next server action: user JWT client, middleware requestId, Origin header. */
export async function serverActionCtx(): Promise<ActionCtx> {
  const h = await headers();
  const incoming = h.get(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : newRequestId();
  const log = withRequest(requestId);
  return {
    client: await serverClient(),
    requestId,
    log,
    origin: h.get("origin"),
    appUrl: env().APP_URL,
    audit: (entry) => audit(entry, { log }),
  };
}
