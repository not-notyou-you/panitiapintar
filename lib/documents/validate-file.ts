import { unzipSync } from "fflate";

// SEC-08: extension + declared MIME + magic bytes must all agree. Pure (no I/O) so it is unit-testable.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_RATIO = 100;
export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;

export type DocKind = "pdf" | "docx" | "txt" | "md";

export const MIME: Record<DocKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

// Browsers report .md inconsistently; accept these declared types per extension.
const ACCEPTED_DECLARED: Record<DocKind, ReadonlySet<string>> = {
  pdf: new Set([MIME.pdf]),
  docx: new Set([MIME.docx]),
  txt: new Set(["text/plain", ""]),
  md: new Set(["text/markdown", "text/x-markdown", "text/plain", "application/octet-stream", ""]),
};

/** Matches document.upload.rejected reasons in LOGGING §5. */
export type RejectReason = "bad_type" | "too_large" | "encrypted" | "macro" | "zip_bomb" | "corrupt";

export type ValidateResult = { ok: true; kind: DocKind; mime: string } | { ok: false; reason: RejectReason };

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? (m[1] ?? "").toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

export function validateFile(name: string, declaredMime: string, bytes: Uint8Array): ValidateResult {
  if (bytes.byteLength === 0) return { ok: false, reason: "corrupt" };
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };
  const ext = extensionOf(name);
  if (ext !== "pdf" && ext !== "docx" && ext !== "txt" && ext !== "md") return { ok: false, reason: "bad_type" };
  const kind: DocKind = ext;
  if (!ACCEPTED_DECLARED[kind].has(declaredMime.split(";")[0]?.trim().toLowerCase() ?? "")) {
    return { ok: false, reason: "bad_type" };
  }

  switch (kind) {
    case "pdf":
      if (!startsWith(bytes, PDF_SIG)) return { ok: false, reason: "bad_type" };
      if (isEncryptedPdf(bytes)) return { ok: false, reason: "encrypted" };
      break;
    case "docx": {
      if (!startsWith(bytes, ZIP_SIG)) return { ok: false, reason: "bad_type" };
      const zip = inspectDocx(bytes);
      if (!zip.ok) return zip;
      break;
    }
    case "txt":
    case "md":
      if (!isPlainText(bytes)) return { ok: false, reason: "bad_type" };
      break;
  }
  return { ok: true, kind, mime: MIME[kind] };
}

/** An /Encrypt entry in any trailer or xref stream dictionary means the PDF is encrypted. */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(text);
}

/** UTF-8 without NUL bytes or other binary control characters (tab/CR/LF allowed). */
export function isPlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}

interface ZipEntryInfo {
  name: string;
  compressed: number;
  uncompressed: number;
}

/** Reads sizes from the central directory without inflating anything. */
export function zipEntries(bytes: Uint8Array): ZipEntryInfo[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: signature 0x06054b50 within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count > MAX_ZIP_ENTRIES || p >= bytes.byteLength) return null;
  const out: ZipEntryInfo[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== 0x02014b50) return null;
    const compressed = view.getUint32(p + 20, true);
    const uncompressed = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = Buffer.from(bytes.subarray(p + 46, p + 46 + nameLen)).toString("utf8");
    out.push({ name, compressed, uncompressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function inspectDocx(bytes: Uint8Array): { ok: true } | { ok: false; reason: RejectReason } {
  const entries = zipEntries(bytes);
  if (!entries) return { ok: false, reason: "corrupt" };
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if (!names.has("word/document.xml")) return { ok: false, reason: "bad_type" };
  if ([...names].some((n) => n.endsWith("vbaproject.bin") || n.endsWith("vbadata.xml"))) {
    return { ok: false, reason: "macro" };
  }
  const total = entries.reduce((s, e) => s + e.uncompressed, 0);
  const packed = Math.max(1, entries.reduce((s, e) => s + e.compressed, 0));
  // 0xFFFFFFFF marks ZIP64 sizes; a .docx never needs them, so treat it as hostile.
  if (
    total > MAX_UNZIPPED_BYTES ||
    total / packed > MAX_ZIP_RATIO ||
    entries.some((e) => e.uncompressed === 0xffffffff)
  ) {
    return { ok: false, reason: "zip_bomb" };
  }
  // Declared sizes can lie: inflate for real, but only up to the same budget.
  const declared = entries.find((e) => e.name.toLowerCase() === "word/document.xml")?.uncompressed ?? 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.toLowerCase() === "word/document.xml" });
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  const body = Object.values(files)[0];
  if (!body) return { ok: false, reason: "corrupt" };
  if (body.byteLength !== declared) return { ok: false, reason: "zip_bomb" };
  return { ok: true };
}
