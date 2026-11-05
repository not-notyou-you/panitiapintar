import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). Never log the result. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Keyed hash so stored rate-limit buckets cannot be reversed to an IP without the salt. The key is
 * derived per calendar month (UTC), so the salt rotates monthly (SEC-12) without manual steps: hashes
 * from different months cannot be linked. Rate-limit windows are at most a day, so nothing breaks.
 */
export function ipHash(ip: string, salt: string = env().IP_HASH_SALT, now: Date = new Date()): string {
  const month = now.toISOString().slice(0, 7);
  const monthKey = createHmac("sha256", salt).update(`ip-month:${month}`).digest();
  return createHmac("sha256", monthKey).update(ip).digest("hex").slice(0, 32);
}

/** Keyed hash of an email for logs and rate-limit keys (SEC-12: emails are never logged raw). */
export function emailHash(email: string, salt: string = env().IP_HASH_SALT): string {
  return createHmac("sha256", salt).update(`email:${email.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}
