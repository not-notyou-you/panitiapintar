import type { Logger } from "pino";
import { AppError } from "./errors";

/**
 * SEC-11: a mutation must come from our own origin. A missing Origin is rejected too: browsers always
 * send it on POST/fetch, so only non-browser clients lack it, and those must set it explicitly.
 */
export function assertSameOrigin(origin: string | null, appUrl: string, log?: Logger): void {
  const expected = new URL(appUrl).origin;
  if (origin === expected) return;
  // Log at most the origin's scheme+host (never a full URL with paths or query).
  let shown = "(none)";
  if (origin) {
    try {
      shown = new URL(origin).origin;
    } catch {
      shown = "(invalid)";
    }
  }
  log?.warn({ event: "security.csrf.blocked", origin: shown }, "origin rejected");
  throw new AppError("FORBIDDEN");
}
