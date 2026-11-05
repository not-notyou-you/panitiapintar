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

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<");

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

export function mockAnswer(prompt: string): string {
  const question = unescape(prompt.match(/<user_question>([\s\S]*)<\/user_question>/)?.[1] ?? "");
  if (question.includes("[[mock:invalid]]")) return "ini bukan JSON";
  if (question.includes("[[mock:canary]]")) {
    return JSON.stringify({ answer: "Kode arsip: CANARY-INT-TEST", source_doc_ids: [] });
  }
  if (INTERNAL_TOPICS.test(question)) return JSON.stringify({ answer: "NOT_FOUND", source_doc_ids: [] });

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

export function mockTransport(): AiTransport {
  return {
    async generate(req: TransportRequest): Promise<TransportResponse> {
      if (req.prompt.includes("[[mock:429]]")) throw new AiTransportError(429, "http_429");
      if (req.prompt.includes("[[mock:500]]")) throw new AiTransportError(500, "http_500");
      if (req.prompt.includes("[[mock:blocked]]")) return { text: "", blockReason: "SAFETY" };
      const text = mockAnswer(req.prompt);
      return { text, inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) };
    },
  };
}
