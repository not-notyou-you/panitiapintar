import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { redactDeep, redact } from "@/lib/privacy";

// LOGGING.md §3. Top-level and one-level-nested keys; deeper strings are caught by the redaction hook.
const SENSITIVE_KEYS = [
  "password",
  "token",
  "apiKey",
  "email",
  "ip",
  "content",
  "prompt",
  "answer",
  "message",
];
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
];

export interface CreateLoggerInput {
  level: LoggerOptions["level"];
  env: string;
  destination?: DestinationStream;
}

export function createLogger({ level, env, destination }: CreateLoggerInput): Logger {
  const options: LoggerOptions = {
    level,
    base: { env },
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label) => ({ level: label }),
      // Runs before path redaction: every free-text string is passed through redact().
      log: (obj) => redactDeep(obj),
    },
    hooks: {
      // The msg argument bypasses formatters.log, so redact string args here.
      logMethod(args, method) {
        const safe = args.map((a) => (typeof a === "string" ? redact(a).text : a)) as typeof args;
        method.apply(this, safe);
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
