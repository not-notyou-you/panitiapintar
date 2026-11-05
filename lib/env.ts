import "server-only";
import { EnvError, parseServerEnv, type ServerEnv } from "./env-schema";

let cached: ServerEnv | undefined;

/** Validated server env. Throws EnvError (and reports config.env.invalid) when incomplete. */
export function env(): ServerEnv {
  if (cached) return cached;
  try {
    cached = parseServerEnv(process.env);
    return cached;
  } catch (err) {
    if (err instanceof EnvError) {
      // The logger depends on env, so write the fatal event directly.
      process.stderr.write(
        JSON.stringify({
          level: "fatal",
          time: new Date().toISOString(),
          event: "config.env.invalid",
          missing: err.problems.map((p) => p.split(":")[0]),
        }) + "\n",
      );
    }
    throw err;
  }
}

export type { ServerEnv };
