// LOGGING §5–6 ⇄ code (CLAUDE.md "Event baru: tambahkan ke katalog di PR yang sama").
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/log/audit-schema";

const ROOT = path.resolve(__dirname, "../..");
const doc = readFileSync(path.join(ROOT, "docs/LOGGING.md"), "utf8");

function section(start: string, end: string): string {
  const from = doc.indexOf(start);
  const to = doc.indexOf(end, from + 1);
  return doc.slice(from, to === -1 ? undefined : to);
}

/** First-column backticked names of a Markdown table; "a / b / c" cells list several. */
function catalogNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const cell = /^\|\s*(`[^|]+)\|/.exec(line)?.[1];
    if (!cell) continue;
    for (const m of cell.matchAll(/`([a-z_]+(?:\.[a-z_]+)+)`/g)) out.add(m[1]!);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const code = ["app", "lib", "components"]
  .flatMap((d) => sourceFiles(path.join(ROOT, d)))
  .concat([path.join(ROOT, "middleware.ts"), path.join(ROOT, "instrumentation.ts")])
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
// SQL functions also write audit rows (approve_document etc.).
const sql = readdirSync(path.join(ROOT, "supabase/migrations"))
  .map((f) => readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"))
  .join("\n");

const eventsInCode = new Set([...code.matchAll(/event:\s*"([a-z_.]+)"/g)].map((m) => m[1]!));

describe("LOGGING §5 event catalog", () => {
  const catalog = catalogNames(section("## 5. Katalog event", "## 6."));
  it("every event emitted by the code is in the catalog", () => {
    expect([...eventsInCode].filter((e) => !catalog.has(e)).sort()).toEqual([]);
  });
  it("every catalog event is emitted somewhere", () => {
    expect([...catalog].filter((e) => !eventsInCode.has(e)).sort()).toEqual([]);
  });
});

describe("LOGGING §6 audit catalog", () => {
  const catalog = catalogNames(section("## 6. Katalog aksi audit", "## 7."));
  it("matches AUDIT_ACTIONS exactly", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual([...catalog].sort());
  });
  it("every audit action is written by the app or a migration", () => {
    const written = (a: string) => code.includes(`"${a}"`) || sql.includes(`'${a}'`);
    expect(AUDIT_ACTIONS.filter((a) => !written(a))).toEqual([]);
  });
});
