import "server-only";
import type { Logger } from "pino";
import { env } from "@/lib/env";
import { createLogger } from "./create-logger";

export const logger: Logger = createLogger({ level: env().LOG_LEVEL, env: env().APP_ENV });

export function withRequest(requestId: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ requestId, ...extra });
}
