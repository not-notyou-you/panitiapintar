import "server-only";
import { AiTransportError, type AiTransport, type TransportRequest, type TransportResponse } from "./types";

// Deterministic stand-in for Gemini (AI_MOCK=true). Picks the document line that best matches the
// question and cites that document. Not a model: good enough for e2e and offline UI work only.
//
// Control phrases in the question force a failure path so the UI states can be exercised by hand:
//   [[mock:429]] [[mock:500]] [[mock:blocked]] [[mock:invalid]] [[mock:canary]]

const STOPWORDS = new Set(
  "apa apakah yang dan di ke dari untuk dengan ini itu ada kah berapa mana kapan bagaimana siapa saya aku kamu bisa boleh tidak acara nya jam".split(
    " ",
  ),
);
const INTERNAL_TOPICS = /anggaran|\brab\b|budget|honor|biaya panitia|notulen|rapat panitia/i;

const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<");

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => w.slice(0, 5));
}

function cleanLine(line: string): string {
  return line
    .replace(/^[#>\-*\s]+/, "")
    .replace(/\|/g, " ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mockAnswer(prompt: string, opts: { internal?: boolean } = {}): string {
  const question = unescape(prompt.match(/<user_question>([\s\S]*)<\/user_question>/)?.[1] ?? "");
  if (question.includes("[[mock:invalid]]")) return "ini bukan JSON";
  if (question.includes("[[mock:canary]]")) {
    return JSON.stringify({ answer: "Kode arsip: CANARY-INT-TEST", source_doc_ids: [] });
  }
  if (!opts.internal && INTERNAL_TOPICS.test(question))
    return JSON.stringify({ answer: "NOT_FOUND", source_doc_ids: [] });

  const wanted = new Set(terms(question));
  let best = { score: 0, line: "", docId: "" };
  for (const m of prompt.matchAll(/<doc id="([^"]+)" title="[^"]*">\n([\s\S]*?)\n<\/doc>/g)) {
    for (const raw of unescape(m[2] ?? "").split("\n")) {
      if (/^\s*#/.test(raw)) continue; // headings carry no answer
      const line = cleanLine(raw);
      // Skip separators and FAQ question lines: they echo the question rather than answer it.
      if (line.length < 12 || /^-+$/.test(line.replace(/\s/g, "")) || line.endsWith("?")) continue;
      const score = new Set(terms(line).filter((t) => wanted.has(t))).size;
      if (score > best.score) best = { score, line, docId: m[1] ?? "" };
    }
  }
  if (best.score === 0) return JSON.stringify({ answer: "NOT_FOUND", source_doc_ids: [] });
  return JSON.stringify({ answer: best.line.slice(0, 600), source_doc_ids: [best.docId] });
}

/** Refine stand-in: splits the source on Markdown headings; keeps text verbatim (no invented facts). */
export function mockRefine(prompt: string): string {
  const m = prompt.match(/<source_document title="([^"]*)">\n([\s\S]*)\n<\/source_document>/);
  const source = unescape(m?.[2] ?? "");
  if (source.includes("[[mock:invalid]]")) return "ini bukan JSON";
  const title = unescape(m?.[1] ?? "").slice(0, 150) || "Dokumen";
  const sections: { heading: string; body: string }[] = [];
  let current = { heading: "Ringkasan", body: [] as string[] };
  const flush = () => {
    const body = current.body.join("\n").trim();
    if (body) sections.push({ heading: current.heading, body: body.slice(0, 20_000) });
  };
  for (const line of source.split("\n")) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      current = { heading: (h[1] ?? "").slice(0, 200), body: [] };
    } else current.body.push(line);
  }
  flush();
  if (sections.length === 0) sections.push({ heading: "Isi", body: source.slice(0, 20_000) || "-" });
  const first = sections[0]?.body.replace(/\s+/g, " ") ?? "";
  return JSON.stringify({ title, summary: first.slice(0, 200), sections: sections.slice(0, 30), faq: [] });
}

const field = (block: string, name: string) =>
  new RegExp(`^${name}: (.*)$`, "m").exec(block)?.[1]?.trim() ?? "";
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Rundown stand-in: spreads the listed activities evenly between start and end. */
export function mockRundown(prompt: string): string {
  const block = unescape(prompt.match(/<rundown_request>([\s\S]*)<\/rundown_request>/)?.[1] ?? "");
  if (block.includes("[[mock:invalid]]")) return JSON.stringify({ rows: [{ time: "9 pagi" }] });
  const start = toMin(field(block, "Mulai") || "09:00");
  const end = toMin(field(block, "Selesai") || "12:00");
  const acts = [
    "Registrasi ulang",
    ...field(block, "Isi acara")
      .split(/[,;]/)
      .map((a) => a.trim())
      .filter(Boolean),
    "Penutupan",
  ];
  const slot = Math.max(5, Math.floor((end - start) / acts.length));
  const rows = acts.map((activity, i) => ({
    time: toHhmm(Math.min(start + i * slot, 23 * 60 + 59)),
    duration_min: slot,
    activity: activity.slice(0, 200),
    pic: i === 0 ? "Registrasi" : "Acara",
  }));
  return JSON.stringify({ rows });
}

/** Checklist stand-in: one generic task per deadline per division, deliberately out of order. */
export function mockChecklist(prompt: string): string {
  const block = unescape(prompt.match(/<checklist_request>([\s\S]*)<\/checklist_request>/)?.[1] ?? "");
  if (block.includes("[[mock:invalid]]")) return "ini bukan JSON";
  const divisions = field(block, "Divisi")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const divs = divisions.length ? divisions : ["Acara", "Logistik"];
  const tasks: Record<string, string> = {
    H: "Briefing pagi dan cek kesiapan",
    "H-1": "Gladi bersih",
    "H-7": "Konfirmasi vendor dan pengisi acara",
    "H-30": "Susun kebutuhan dan anggaran divisi",
  };
  const items = divs.flatMap((division) =>
    Object.entries(tasks).map(([due, task]) => ({ due, division: division.slice(0, 60), task })),
  );
  return JSON.stringify({ items });
}

export function mockTransport(): AiTransport {
  return {
    async generate(req: TransportRequest): Promise<TransportResponse> {
      if (req.prompt.includes("[[mock:429]]")) throw new AiTransportError(429, "http_429");
      if (req.prompt.includes("[[mock:500]]")) throw new AiTransportError(500, "http_500");
      if (req.prompt.includes("[[mock:blocked]]")) return { text: "", blockReason: "SAFETY" };
      const text = req.prompt.startsWith("<source_document")
        ? mockRefine(req.prompt)
        : req.prompt.includes("<rundown_request>")
          ? mockRundown(req.prompt)
          : req.prompt.includes("<checklist_request>")
            ? mockChecklist(req.prompt)
            : mockAnswer(req.prompt, { internal: req.system.includes("asisten internal panitia") });
      return {
        text,
        inputTokens: Math.ceil(req.prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    },
  };
}
