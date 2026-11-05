import "server-only";
import type { Logger } from "pino";
import { serviceClient } from "@/lib/supabase/service";

// SEC-07. Fixed windows aligned to the epoch, matching rate_limit_hit() in 0002_functions.sql.
export const RATE_LIMITS = {
  chat_public: [
    { name: "min", windowSeconds: 60, max: 10 },
    { name: "day", windowSeconds: 86_400, max: 100 },
  ],
  chat_public_event: [{ name: "hour", windowSeconds: 3_600, max: 600 }],
  // Shared by /api/chat/internal and /api/generate/[kind] (SEC-07).
  chat_internal: [
    { name: "min", windowSeconds: 60, max: 20 },
    { name: "day", windowSeconds: 86_400, max: 300 },
  ],
  upload: [{ name: "hour", windowSeconds: 3_600, max: 10 }],
  refine: [{ name: "day", windowSeconds: 86_400, max: 20 }],
  login: [{ name: "hour", windowSeconds: 3_600, max: 5 }],
} as const satisfies Record<string, ReadonlyArray<{ name: string; windowSeconds: number; max: number }>>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; limit: number; window: string };

/** Atomically counts one hit; true while still within `max`. */
export type HitFn = (bucket: string, windowSeconds: number, max: number) => Promise<boolean>;

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("rate limit store unavailable");
    this.name = "RateLimitUnavailableError";
  }
}

// rate_limit_hit is granted to service_role only (0004_harden), so this is a system task.
export const rpcHit: HitFn = async (bucket, windowSeconds, max) => {
  const { data, error } = await serviceClient().rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error || typeof data !== "boolean") throw new RateLimitUnavailableError();
  return data;
};

/**
 * Checks every window of a bucket in order and stops at the first one exceeded.
 * `key` must already be non-identifying (an IP hash, user id, committee id). Fails closed.
 */
export async function rateLimit(
  bucket: RateLimitBucket,
  key: string,
  deps: { hit?: HitFn; now?: () => number; log?: Logger } = {},
): Promise<RateLimitResult> {
  const hit = deps.hit ?? rpcHit;
  const now = deps.now ?? Date.now;
  for (const w of RATE_LIMITS[bucket]) {
    const allowed = await hit(`${bucket}:${w.name}:${key}`, w.windowSeconds, w.max);
    if (!allowed) {
      const elapsed = Math.floor(now() / 1000) % w.windowSeconds;
      deps.log?.warn(
        { event: "ratelimit.exceeded", bucket: `${bucket}:${w.name}`, limit: w.max },
        "rate limit exceeded",
      );
      return { ok: false, retryAfterSeconds: Math.max(1, w.windowSeconds - elapsed), limit: w.max, window: w.name };
    }
  }
  return { ok: true };
}
