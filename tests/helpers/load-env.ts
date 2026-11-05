import { execSync } from "node:child_process";

// Integration/security tests need a local Supabase. Keys come from the environment (CI exports them)
// or, locally, from `supabase status`. Without a running stack, DB suites are skipped — unless
// REQUIRE_SUPABASE=1, in which case they must run.
const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function fromSupabaseStatus(): Record<string, string> {
  try {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", timeout: 20_000, stdio: "pipe" });
    const vars = Object.fromEntries(
      out
        .split(/\r?\n/)
        .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1], m[2]]),
    );
    return {
      NEXT_PUBLIC_SUPABASE_URL: vars.API_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: vars.ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: vars.SERVICE_ROLE_KEY ?? "",
    };
  } catch {
    return {};
  }
}

if (KEYS.some((k) => !process.env[k] || process.env[k]?.startsWith("local-placeholder"))) {
  const status = fromSupabaseStatus();
  for (const k of KEYS) if (status[k]) process.env[k] = status[k];
}

process.env.SUPABASE_AVAILABLE = KEYS.every((k) => process.env[k]) ? "1" : "0";
if (process.env.REQUIRE_SUPABASE === "1" && process.env.SUPABASE_AVAILABLE !== "1") {
  throw new Error("REQUIRE_SUPABASE=1 but local Supabase keys are unavailable (run `npx supabase start`).");
}
