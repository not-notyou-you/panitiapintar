// Review aid (INTERFACE §4.7): numbers, dates, times and prices in the AI result that do not appear in the
// original text. A flagged section is not necessarily wrong; it tells the admin where to look first.

const MONTHS =
  "januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|ags|sep|okt|nov|des";

const FACT_PATTERNS: RegExp[] = [
  // 12 Desember 2026, 12 Des
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\b(?:\\s+\\d{4})?`, "gi"),
  // 2026-12-12, 12/12/2026, 12-12-26
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  // 08.00, 8:30
  /\b\d{1,2}[.:]\d{2}\b/g,
  // Rp150.000, Rp 1,5 juta
  /\bRp\s?\d+(?:[.,]\d+)*(?:\s?(?:rb|ribu|jt|juta)\b)?/gi,
  // any other number (with thousand separators)
  /\b\d+(?:[.,]\d+)*\b/g,
];

/** Canonical form so "08.00" and "08:00" or "Rp 150.000" and "Rp150.000" compare equal. */
export function normalizeFact(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(\d)[.:](\d{2})$/, "$1:$2")
    .replace(/^0(\d:)/, "$1");
}

export function extractFacts(text: string): string[] {
  const out = new Set<string>();
  let rest = text;
  for (const p of FACT_PATTERNS) {
    rest = rest.replace(p, (m) => {
      out.add(normalizeFact(m));
      return " ";
    });
  }
  return [...out];
}

export interface SectionDiff {
  heading: string;
  body: string;
  /** Facts in this section that the original text does not contain. */
  unknownFacts: string[];
}

/** Splits Markdown on headings and lists, per section, the facts missing from `original`. */
export function diffFacts(original: string, refined: string): SectionDiff[] {
  const known = new Set(extractFacts(original));
  // Bare numbers inside known compound facts (e.g. "12" from "12 desember 2026") count as known too.
  for (const f of [...known]) for (const n of f.match(/\d+/g) ?? []) known.add(n);
  const sections: SectionDiff[] = [];
  let current: SectionDiff = { heading: "", body: "", unknownFacts: [] };
  const flush = () => {
    if (current.heading || current.body.trim()) {
      current.unknownFacts = extractFacts(`${current.heading}\n${current.body}`).filter((f) => !known.has(f));
      sections.push(current);
    }
  };
  for (const line of refined.split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      current = { heading: h[1] ?? "", body: "", unknownFacts: [] };
    } else {
      current.body += `${line}\n`;
    }
  }
  flush();
  return sections;
}
