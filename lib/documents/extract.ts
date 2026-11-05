import "server-only";
import type { DocKind } from "./validate-file";

export const EXTRACT_TIMEOUT_MS = 30_000;
export const MAX_TEXT_CHARS = 200_000;

export type ExtractFailure = "timeout" | "encrypted" | "too_long" | "empty" | "corrupt";

export class ExtractError extends Error {
  constructor(readonly reason: ExtractFailure) {
    super(`extract failed: ${reason}`);
    this.name = "ExtractError";
  }
}

async function extractRaw(kind: DocKind, bytes: Uint8Array): Promise<string> {
  switch (kind) {
    case "pdf": {
      const { getDocumentProxy, extractText } = await import("unpdf");
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractText(pdf, { mergePages: true });
        return Array.isArray(text) ? text.join("\n") : text;
      } catch (err) {
        if (err instanceof Error && /password/i.test(err.name + err.message))
          throw new ExtractError("encrypted");
        throw new ExtractError("corrupt");
      }
    }
    case "docx": {
      const mammoth = await import("mammoth");
      try {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return value;
      } catch {
        throw new ExtractError("corrupt");
      }
    }
    case "txt":
    case "md":
      return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Plain text of an already validated file. Bounded in time (30 s) and length (200k chars). */
export async function extractText(
  kind: DocKind,
  bytes: Uint8Array,
  timeoutMs: number = EXTRACT_TIMEOUT_MS,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractError("timeout")), timeoutMs);
  });
  try {
    const raw = await Promise.race([extractRaw(kind, bytes), timeout]);
    const text = raw
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length === 0) throw new ExtractError("empty");
    if (text.length > MAX_TEXT_CHARS) throw new ExtractError("too_long");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
