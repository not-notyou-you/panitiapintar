"use server";

import { headers } from "next/headers";
import { requestMagicLink } from "@/lib/actions/auth";
import { serverActionCtx } from "@/lib/actions/server-ctx";
import { clientIp, ipHash } from "@/lib/privacy/ip-hash";

export async function requestMagicLinkAction(input: unknown) {
  const ctx = await serverActionCtx();
  return requestMagicLink(input, ctx, { ipHash: ipHash(clientIp(await headers())) });
}
