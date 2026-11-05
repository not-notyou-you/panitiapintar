import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). Never log the result. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Keyed hash so stored rate-limit buckets cannot be reversed to an IP without the salt. */
export function ipHash(ip: string, salt: string = env().IP_HASH_SALT): string {
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}
