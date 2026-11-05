// Test file builders (dummy content only). No "@/" imports: shared with Playwright.
import { strToU8, zipSync } from "fflate";

// ---------- file fixtures (dummy content only) ----------

const enc = new TextEncoder();

/** Minimal single-page PDF with real xref offsets, so unpdf can extract `text`. */
export function makePdf(text: string, opts: { encrypt?: boolean } = {}): Uint8Array {
  const safe = text.replace(/[()\\]/g, "");
  const stream = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (opts.encrypt) objects.push("<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  const encrypt = opts.encrypt ? ` /Encrypt ${objects.length} 0 R` : "";
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(body);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

function documentXml(paragraphs: string[], padding = ""): string {
  const ps = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps}${padding}</w:body></w:document>`;
}

export function makeDocx(
  paragraphs: string[],
  opts: { macro?: boolean; bombBytes?: number } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "word/document.xml": strToU8(documentXml(paragraphs, opts.bombBytes ? " ".repeat(opts.bombBytes) : "")),
  };
  if (opts.macro) files["word/vbaProject.bin"] = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]);
  return zipSync(files, { level: 9 });
}

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
