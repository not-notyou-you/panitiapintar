import { describe, expect, it } from "vitest";
import { EnvError, parseServerEnv } from "@/lib/env-schema";
import { validEnv } from "../helpers/env-fixture";

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseServerEnv(source);
  } catch (err) {
    if (err instanceof EnvError) return err.problems;
    throw err;
  }
  return [];
}

describe("parseServerEnv", () => {
  it("accepts a complete env", () => {
    const env = parseServerEnv(validEnv);
    expect(env.TURNSTILE_ENABLED).toBe(false);
    expect(env.GEMINI_MODEL_FALLBACK).toBeUndefined();
  });

  it("names every missing variable", () => {
    const { GEMINI_API_KEY: _g, SUPABASE_SERVICE_ROLE_KEY: _s, ...rest } = validEnv;
    expect(problems(rest)).toEqual(
      expect.arrayContaining(["GEMINI_API_KEY: missing", "SUPABASE_SERVICE_ROLE_KEY: missing"]),
    );
  });

  it("treats blank values as missing", () => {
    expect(problems({ ...validEnv, CRON_SECRET: "  " })).toContain("CRON_SECRET: missing");
  });

  it("rejects a short IP_HASH_SALT", () => {
    expect(problems({ ...validEnv, IP_HASH_SALT: "short" })[0]).toMatch(/^IP_HASH_SALT:/);
  });

  it("requires TURNSTILE_SECRET_KEY when Turnstile is enabled", () => {
    expect(problems({ ...validEnv, TURNSTILE_ENABLED: "true" })[0]).toMatch(/^TURNSTILE_SECRET_KEY:/);
  });

  it("rejects AI_MOCK in production", () => {
    expect(problems({ ...validEnv, APP_ENV: "production", AI_MOCK: "true" })[0]).toMatch(/^AI_MOCK:/);
    expect(problems({ ...validEnv, APP_ENV: "preview", AI_MOCK: "true" })).toEqual([]);
  });

  it("rejects secrets under the NEXT_PUBLIC_ prefix", () => {
    expect(problems({ ...validEnv, NEXT_PUBLIC_GEMINI_API_KEY: "leak" })[0]).toMatch(
      /^NEXT_PUBLIC_GEMINI_API_KEY: secrets must not/,
    );
  });

  it("never echoes values in the error message", () => {
    const secret = "super-secret-value-should-not-appear";
    try {
      parseServerEnv({ ...validEnv, NEXT_PUBLIC_SERVICE_TOKEN: secret, IP_HASH_SALT: secret.slice(0, 10) });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret.slice(0, 10));
    }
  });
});
