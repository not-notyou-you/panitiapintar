import { normalizeForPii } from "./normalize";

export type PiiType = "email" | "npwp" | "nik" | "nim" | "phone" | "account";
export type PiiCounts = Partial<Record<PiiType, number>>;

export interface RedactResult {
  text: string;
  found: PiiCounts;
}

export const PII_LABELS: Record<PiiType, string> = {
  email: "[EMAIL]",
  npwp: "[NPWP]",
  nik: "[NIK]",
  nim: "[NIM]",
  phone: "[NOMOR_HP]",
  account: "[NOMOR_REKENING]",
};

// Applied in order. Email runs first because digit patterns would otherwise eat a numeric
// local part ("081234567890@x.test") and leave the rest of the address behind.
// Digit lookarounds are used instead of \b so "HP:0812..." and "NIM00000..." still match.
const PATTERNS: ReadonlyArray<readonly [PiiType, RegExp]> = [
  ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ["npwp", /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)/g],
  ["nik", /(?<!\d)\d{16}(?!\d)/g],
  ["nim", /(?<!\d)0000\d{7}(?!\d)/g],
  ["phone", /(?<![\d+])(?:\+62|62|0)[\s.-]?\(?8\d{1,3}\)?(?:[\s.-]?\d{3,4})(?:[\s.-]?\d{3,5})(?!\d)/g],
  // 10–19 digits, optionally grouped by single spaces or hyphens.
  ["account", /(?<!\d)\d(?:[ -]?\d){9,18}(?!\d)/g],
];

/** Replaces PII with labels. Returns counts only; original values are never returned. */
export function redact(input: string): RedactResult {
  let text = normalizeForPii(input);
  const found: PiiCounts = {};
  for (const [type, pattern] of PATTERNS) {
    text = text.replace(pattern, () => {
      found[type] = (found[type] ?? 0) + 1;
      return PII_LABELS[type];
    });
  }
  return { text, found };
}

/** Detects PII without returning any matched value. */
export function scanPii(input: string): { found: PiiCounts; total: number } {
  const { found } = redact(input);
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  return { found, total };
}

export function mergeCounts(target: PiiCounts, source: PiiCounts): PiiCounts {
  for (const [k, v] of Object.entries(source) as [PiiType, number][]) target[k] = (target[k] ?? 0) + v;
  return target;
}

const MAX_DEPTH = 8;

/** Redacts every string in a JSON-like value. Cycles and over-deep branches become "[TRUNCATED]". */
export function redactDeep<T>(value: T, found: PiiCounts = {}): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      const r = redact(v);
      mergeCounts(found, r.found);
      return r.text;
    }
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v;
    if (depth >= MAX_DEPTH || seen.has(v)) return "[TRUNCATED]";
    seen.add(v);
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    if (v instanceof Error)
      return {
        name: v.name,
        message: walk(v.message, depth + 1),
        stack: v.stack === undefined ? undefined : walk(v.stack, depth + 1),
      };
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v)) out[k] = walk(item, depth + 1);
    return out;
  };
  return walk(value, 0) as T;
}
