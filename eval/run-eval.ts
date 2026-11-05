// AI evaluation runner (TESTING §4). Sends eval/questions.json to the LOCAL public chat endpoint with a
// pause between requests, then writes eval/results/YYYY-MM-DD.csv for manual grading by two reviewers.
//
//   npm run dev                                   # in another terminal (AI_MOCK=false for real Gemini)
//   npm run eval -- --slug festival-teknologi-fiktif [--delay 6500] [--limit 10] [--base http://localhost:3000]
//
// chat_public allows 10 requests/minute and 100/day per IP (SEC-07); 150 questions do not fit in one
// day, so run one event per day (or per --limit batch). The script never bypasses the limit.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const fileSchema = z.object({
  events: z.array(
    z.object({
      slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
      leakMarkers: z.array(z.string().min(4)),
      questions: z.array(
        z.object({
          category: z.enum(["normal", "jebakan", "injeksi"]),
          question: z.string().min(1).max(1000),
          expected: z.string(),
        }),
      ),
    }),
  ),
});

const responseSchema = z.object({
  answer: z.string(),
  answered: z.boolean(),
  sources: z.array(z.object({ documentId: z.string(), title: z.string() })),
  requestId: z.string(),
});

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = new URL(arg("base") ?? "http://localhost:3000");
const delayMs = Math.max(6000, Number(arg("delay") ?? 6500)); // below 6 s the per-minute limit trips
const limit = Number(arg("limit") ?? Infinity);
const onlySlug = arg("slug");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  process.stderr.write("run-eval only targets a local server (--base http://localhost:3000)\n");
  process.exit(2);
}

const ROOT = path.resolve(__dirname);
const data = fileSchema.parse(JSON.parse(readFileSync(path.join(ROOT, "questions.json"), "utf8")));

/** Same CSV rules as the log export: quote separators, neutralise formulas. */
function cell(v: string | number | boolean): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  slug: string;
  pertanyaan: string;
  kategori: string;
  harapan: string;
  jawaban: string;
  sumber: string;
  answered: boolean | "";
  latencyMs: number;
  requestId: string;
  status: number;
  bocor: boolean;
}

async function ask(
  slug: string,
  question: string,
): Promise<Omit<Row, "slug" | "pertanyaan" | "kategori" | "harapan" | "bocor">> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(new URL("/api/chat/public", base), {
      method: "POST",
      // SEC-11: non-browser clients must send the app origin explicitly.
      headers: { "content-type": "application/json", origin: base.origin },
      body: JSON.stringify({ slug, message: question, history: [] }),
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);
    const json: unknown = await res.json().catch(() => null);
    const ok = responseSchema.safeParse(json);
    if (res.ok && ok.success) {
      return {
        jawaban: ok.data.answer,
        sumber: ok.data.sources.map((s) => s.title).join(" | "),
        answered: ok.data.answered,
        latencyMs,
        requestId: ok.data.requestId,
        status: res.status,
      };
    }
    const err = (json as { error?: { code?: string; requestId?: string } } | null)?.error;
    return {
      jawaban: `[error ${err?.code ?? res.status}]`,
      sumber: "",
      answered: "",
      latencyMs,
      requestId: err?.requestId ?? res.headers.get("x-request-id") ?? "",
      status: res.status,
    };
  } catch {
    return {
      jawaban: "[timeout/jaringan]",
      sumber: "",
      answered: "",
      latencyMs: Math.round(performance.now() - started),
      requestId: "",
      status: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const events = data.events.filter((e) => !onlySlug || e.slug === onlySlug);
  if (events.length === 0) throw new Error(`unknown --slug ${onlySlug}`);
  const jobs = events.flatMap((e) => e.questions.map((q) => ({ e, q }))).slice(0, limit);
  if (jobs.length > 100) {
    process.stderr.write(
      `warning: ${jobs.length} questions exceed the 100/day per-IP limit; later ones will get 429\n`,
    );
  }

  const rows: Row[] = [];
  for (const [i, { e, q }] of jobs.entries()) {
    if (i > 0) await sleep(delayMs);
    const r = await ask(e.slug, q.question);
    const bocor = e.leakMarkers.some((m) => r.jawaban.includes(m));
    rows.push({
      slug: e.slug,
      pertanyaan: q.question,
      kategori: q.category,
      harapan: q.expected,
      bocor,
      ...r,
    });
    process.stdout.write(
      `[${i + 1}/${jobs.length}] ${e.slug} ${q.category} → ${r.status} answered=${r.answered} ${r.latencyMs}ms${bocor ? " BOCOR" : ""}\n`,
    );
  }

  const header = [
    "slug",
    "pertanyaan",
    "kategori",
    "harapan",
    "jawaban",
    "sumber",
    "answered",
    "latency_ms",
    "request_id",
    "http_status",
    "bocor_internal",
    "penilai_1",
    "penilai_2",
  ];
  const lines = rows.map((r) =>
    [
      r.slug,
      r.pertanyaan,
      r.kategori,
      r.harapan,
      r.jawaban,
      r.sumber,
      r.answered,
      r.latencyMs,
      r.requestId,
      r.status,
      r.bocor,
      "",
      "",
    ]
      .map(cell)
      .join(","),
  );
  const outDir = path.join(ROOT, "results");
  mkdirSync(outDir, { recursive: true });
  const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10); // WIB date
  let out = path.join(outDir, `${day}.csv`);
  for (let n = 2; existsSync(out); n++) out = path.join(outDir, `${day}-${n}.csv`);
  writeFileSync(out, `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`);

  const leaks = rows.filter((r) => r.bocor).length;
  const byCat = (c: string) => rows.filter((r) => r.kategori === c);
  const unanswered = (rs: Row[]) => rs.filter((r) => r.answered === false).length;
  process.stdout.write(
    [
      `\nSaved ${path.relative(process.cwd(), out)} (${rows.length} rows)`,
      `kebocoran internal (otomatis): ${leaks}`,
      `normal terjawab: ${byCat("normal").filter((r) => r.answered === true).length}/${byCat("normal").length}`,
      `jebakan tidak dijawab: ${unanswered(byCat("jebakan"))}/${byCat("jebakan").length}`,
      "Akurasi dan halusinasi dinilai manual oleh dua penilai (kolom penilai_1/penilai_2).\n",
    ].join("\n"),
  );
  if (leaks > 0) process.exitCode = 1;
}

void main();
