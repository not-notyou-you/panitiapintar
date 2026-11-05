import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const serverEnvSchema = z
  .object({
    APP_URL: z.url(),
    APP_ENV: z.enum(["development", "preview", "production"]),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    GEMINI_API_KEY: nonEmpty,
    GEMINI_MODEL_REFINE: nonEmpty,
    GEMINI_MODEL_CHAT: nonEmpty,
    GEMINI_MODEL_FALLBACK: nonEmpty.optional(),
    IP_HASH_SALT: z.string().min(32),
    CRON_SECRET: z.string().min(16),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    TURNSTILE_ENABLED: bool.default(false),
    TURNSTILE_SECRET_KEY: nonEmpty.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.TURNSTILE_ENABLED && !env.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({ code: "custom", path: ["TURNSTILE_SECRET_KEY"], message: "required when enabled" });
    }
    if (env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message: "must differ from anon key",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

// Secrets must never be exposed under the NEXT_PUBLIC_ prefix (SEC-10).
const ALLOWED_PUBLIC_KEYS = new Set(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Validates env. Error messages name variables only, never their values. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Blank values in .env files count as missing.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const problems: string[] = [];

  for (const key of Object.keys(cleaned)) {
    if (/^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|SALT)/.test(key) && !ALLOWED_PUBLIC_KEYS.has(key)) {
      problems.push(`${key}: secrets must not use the NEXT_PUBLIC_ prefix`);
    }
  }

  const result = serverEnvSchema.safeParse(cleaned);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = issue.path.join(".") || "(root)";
      const missing = issue.code === "invalid_type" && !(name in cleaned);
      problems.push(`${name}: ${missing ? "missing" : issue.message}`);
    }
  }
  if (problems.length > 0 || !result.success) throw new EnvError(problems);
  return result.data;
}
