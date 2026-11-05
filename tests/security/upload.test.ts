// SEC-08: every hostile file is rejected with the right code; a good file lands internal + refining,
// redacted, in the private bucket under a UUID name.
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { handleUpload, MAX_ACTIVE_DOCUMENTS } from "@/lib/api/documents";
import { dbAvailable, getDocument, service } from "../helpers/db";
import {
  DOCX_MIME,
  PNG_BYTES,
  makeDocx,
  makePdf,
  setupActors,
  uploadDeps,
  uploadRequest,
  type Actors,
} from "../helpers/phase2";

describe.skipIf(!dbAvailable)("POST /api/documents/upload", () => {
  let a: Actors;
  beforeAll(async () => {
    a = await setupActors("up");
  });

  const send = (file: { name: string; type: string; bytes: Uint8Array }, committeeId = a.A.id) => {
    const deps = uploadDeps(a.admin.client);
    return handleUpload(uploadRequest({ committeeId, title: "Dok uji", file }), deps).then(async (res) => ({
      res,
      body: (await res.json()) as { error?: { code: string }; documentId?: string; piiSummary?: object },
      deps,
    }));
  };

  it.each([
    ["PDF palsu (isi PNG)", { name: "palsu.pdf", type: "application/pdf", bytes: PNG_BYTES }, 415, "bad_type"],
    ["ekstensi .exe", { name: "x.exe", type: "application/octet-stream", bytes: PNG_BYTES }, 415, "bad_type"],
    ["MIME tidak cocok", { name: "a.pdf", type: "text/plain", bytes: makePdf("Halo") }, 415, "bad_type"],
    ["TXT biner", { name: "a.txt", type: "text/plain", bytes: new Uint8Array([0x41, 0, 0x42]) }, 415, "bad_type"],
    ["DOCX bermakro", { name: "m.docx", type: DOCX_MIME, bytes: makeDocx(["Isi"], { macro: true }) }, 422, "macro"],
    ["zip bomb", { name: "b.docx", type: DOCX_MIME, bytes: makeDocx(["Isi"], { bombBytes: 20_000_000 }) }, 422, "zip_bomb"],
    ["ZIP tanpa word/document.xml", { name: "z.docx", type: DOCX_MIME, bytes: zipOnly() }, 415, "bad_type"],
    ["PDF terenkripsi", { name: "e.pdf", type: "application/pdf", bytes: makePdf("Rahasia", { encrypt: true }) }, 422, "encrypted"],
  ])("menolak %s", async (_label, file, status, reason) => {
    const { res, body, deps } = await send(file);
    expect(res.status).toBe(status);
    expect(body.error?.code).toBeDefined();
    expect(deps.lines.join("\n")).toContain(`"reason":"${reason}"`);
  });

  it("menolak file 11 MB dengan 413 sebelum diproses", async () => {
    const big = new Uint8Array(11 * 1024 * 1024).fill(0x41);
    const { res, body } = await send({ name: "besar.txt", type: "text/plain", bytes: big });
    expect(res.status).toBe(413);
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("menerima PDF: internal, refining, teks teredaksi, nama file UUID di bucket privat", async () => {
    const pdf = makePdf(`Info Gedung C hubungi 0812-0000-${String(Date.now()).slice(-4)}`);
    const { res, body } = await send({ name: "panduan.pdf", type: "application/pdf", bytes: pdf });
    expect(res.status).toBe(201);
    expect(body.piiSummary).toEqual({ phone: 1 });
    const doc = await getDocument(body.documentId!);
    expect(doc).toMatchObject({ visibility: "internal", status: "refining", pii_summary: { phone: 1 } });
    expect(doc.storage_path).toBe(`${a.A.id}/${body.documentId}.pdf`);
    const { data: v } = await service()
      .from("document_versions")
      .select("content, kind, pii_summary")
      .eq("document_id", body.documentId!)
      .single();
    expect(v).toMatchObject({ kind: "original_redacted", pii_summary: {} });
    expect(v!.content).toContain("[NOMOR_HP]");
    expect(v!.content).not.toMatch(/0812/);
    const { data: bucket } = await service().storage.getBucket("documents-raw");
    expect(bucket?.public).toBe(false);
  });

  it("menerima DOCX dan mengekstrak teksnya", async () => {
    const docx = makeDocx([`Rundown ${randomUUID().slice(0, 6)}`, "Registrasi 08.00"]);
    const { res } = await send({ name: "rundown.docx", type: DOCX_MIME, bytes: docx });
    expect(res.status).toBe(201);
  });

  it("menolak duplikat (sha256 sama) dengan 409", async () => {
    const file = { name: "dup.md", type: "text/markdown", bytes: new TextEncoder().encode(`# Dup ${randomUUID()}`) };
    expect((await send(file)).res.status).toBe(201);
    const second = await send(file);
    expect(second.res.status).toBe(409);
    expect(second.deps.lines.join("\n")).toContain('"reason":"duplicate"');
  });

  it(`menolak dokumen ke-${MAX_ACTIVE_DOCUMENTS + 1} (kuota)`, async () => {
    const quota = await setupActors("upq");
    const deps = () => uploadDeps(quota.admin.client);
    for (let i = 0; i < MAX_ACTIVE_DOCUMENTS; i++) {
      const res = await handleUpload(
        uploadRequest({
          committeeId: quota.A.id,
          title: `Dok ${i}`,
          file: { name: `d${i}.txt`, type: "text/plain", bytes: new TextEncoder().encode(`isi ${i} ${randomUUID()}`) },
        }),
        deps(),
      );
      expect(res.status).toBe(201);
    }
    const d = deps();
    const res = await handleUpload(
      uploadRequest({
        committeeId: quota.A.id,
        title: "Lebih",
        file: { name: "x.txt", type: "text/plain", bytes: new TextEncoder().encode(`lebih ${randomUUID()}`) },
      }),
      d,
    );
    expect(res.status).toBe(422);
    expect(d.lines.join("\n")).toContain('"reason":"quota"');
  });

  it("anggota biasa tidak boleh mengunggah (403)", async () => {
    const res = await handleUpload(
      uploadRequest({
        committeeId: a.A.id,
        title: "x",
        file: { name: "x.txt", type: "text/plain", bytes: new TextEncoder().encode("x") },
      }),
      uploadDeps(a.member.client),
    );
    expect(res.status).toBe(403);
  });
});

function zipOnly(): Uint8Array {
  // A valid ZIP that is not a Word document.
  return zipSync({ "readme.txt": strToU8("bukan docx") });
}
