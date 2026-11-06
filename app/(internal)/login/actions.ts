"use server";

import { headers } from "next/headers";
import { changePassword, signInWithPassword } from "@/lib/actions/auth";
import { serverActionCtx } from "@/lib/actions/server-ctx";
import { clientIp, ipHash } from "@/lib/privacy/ip-hash";

export async function signInAction(input: unknown) {
  const ctx = await serverActionCtx();
  return signInWithPassword(input, ctx, { ipHash: ipHash(clientIp(await headers())) });
}

export async function changePasswordAction(input: unknown) {
  const ctx = await serverActionCtx();
  return changePassword(input, ctx, { ipHash: ipHash(clientIp(await headers())) });
}
