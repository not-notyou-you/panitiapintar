// SEC-10 step 4: record a key rotation in audit_logs (key name only, never its value).
//   npx tsx --env-file=.env.local scripts/audit-key-rotated.ts GEMINI_API_KEY
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY of the target project (system task).
import { createClient } from "@supabase/supabase-js";
import { ulid } from "ulid";

const KEYS = [
  "GEMINI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "CRON_SECRET",
  "IP_HASH_SALT",
  "TURNSTILE_SECRET_KEY",
] as const;

const key = process.argv[2];
if (!key || !(KEYS as readonly string[]).includes(key)) {
  process.stderr.write(`Usage: audit-key-rotated.ts <${KEYS.join("|")}>\n`);
  process.exit(2);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  process.stderr.write("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required\n");
  process.exit(2);
}

const requestId = `req_${ulid()}`;
const { error } = await createClient(url, service, { auth: { persistSession: false } })
  .from("audit_logs")
  .insert({
    actor_role: "system",
    action: "config.key.rotated",
    target_type: "system",
    outcome: "success",
    metadata: { key },
    request_id: requestId,
  });
if (error) {
  process.stderr.write(`audit insert failed: ${error.code}\n`);
  process.exit(1);
}
process.stdout.write(`config.key.rotated recorded for ${key} (${requestId})\n`);
