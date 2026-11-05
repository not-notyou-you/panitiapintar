#!/usr/bin/env node
// SEC-10 secret scan without extra dependencies (stand-in for gitleaks).
//   node scripts/check-secrets.mjs           → staged files (pre-commit hook)
//   node scripts/check-secrets.mjs --all     → every tracked file (CI)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const all = process.argv.includes("--all");
const files = execFileSync(
  "git",
  all ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
  {
    encoding: "utf8",
  },
)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !/^(package-lock\.json|.*\.(png|jpg|jpeg|gif|ico|pdf|docx|woff2?|zip))$/i.test(f));

const RULES = [
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Supabase secret key", re: /sb_secret_[0-9A-Za-z_-]{20,}/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "assigned secret env",
    re: /^(SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|CRON_SECRET|IP_HASH_SALT|TURNSTILE_SECRET_KEY)=\S{8,}/m,
  },
];

/** A JWT is only a finding when its payload really decodes to a non-demo service_role key. */
function serviceRoleJwt(text) {
  for (const m of text.matchAll(/eyJ[0-9A-Za-z_-]{10,}\.([0-9A-Za-z_-]{10,})\.[0-9A-Za-z_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload.role === "service_role" && payload.iss !== "supabase-demo") return true;
    } catch {
      // not a JWT
    }
  }
  return false;
}

const findings = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const r of RULES) if (r.re.test(text)) findings.push(`${f}: ${r.name}`);
  if (serviceRoleJwt(text)) findings.push(`${f}: Supabase service_role JWT`);
}

if (findings.length > 0) {
  process.stderr.write(`Possible secrets found (values not shown):\n  ${findings.join("\n  ")}\n`);
  process.exit(1);
}
process.stdout.write(`check-secrets: ${files.length} file(s) clean\n`);
