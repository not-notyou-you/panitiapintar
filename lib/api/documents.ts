import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireMembership, requireUser } from "@/lib/auth/guards";
import { failIfStale } from "@/lib/documents/pipeline";
import { ExtractError, extractText } from "@/lib/documents/extract";
import { MAX_FILE_BYTES, validateFile, type RejectReason } from "@/lib/documents/validate-file";
import { AppError, type ErrorCode } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { redact, scanPii } from "@/lib/privacy";
import type { RateLimitResult } from "@/lib/rate-limit";
import { uploadFieldsSchema, uuidSchema } from "@/lib/validation/admin";
import { RateLimitedError, loadDocument, respond, routeGuard, type RouteDeps } from "./respond";

export const MAX_ACTIVE_DOCUMENTS = 10;
const MULTIPART_OVERHEAD = 64 * 1024;
const BUCKET = "documents-raw";

export interface UploadDeps extends RouteDeps {
  svc: SupabaseClient;
  rateLimit: (bucket: "upload" | "refine", key: string) => Promise<RateLimitResult>;
  /** Runs the refine step after the response (next/server `after()` in production). */
  schedule: (documentId: string) => void;
}

type UploadRejection = RejectReason | "duplicate" | "quota" | "too_long" | "empty" | "timeout";

const REJECTION: Record<UploadRejection, { code: ErrorCode; message: string }> = {
  bad_type: { code: "UNSUPPORTED_FILE", message: "Tipe file tidak didukung. Gunakan PDF, DOCX, TXT, atau MD." },
  too_large: { code: "PAYLOAD_TOO_LARGE", message: "Ukuran file maksimal 10 MB." },
  encrypted: { code: "UNPROCESSABLE", message: "PDF terenkripsi atau berpassword tidak dapat diproses." },
  macro: { code: "UNPROCESSABLE", message: "Dokumen berisi makro dan ditolak." },
  zip_bomb: { code: "UNPROCESSABLE", message: "Struktur file tidak wajar dan ditolak." },
  corrupt: { code: "UNPROCESSABLE", message: "File rusak atau tidak dapat dibaca." },
  too_long: { code: "UNPROCESSABLE", message: "Teks dokumen melebihi 200.000 karakter." },
  empty: { code: "UNPROCESSABLE", message: "Tidak ada teks yang bisa dibaca dari file ini." },
  timeout: { code: "UNPROCESSABLE", message: "Pembacaan file terlalu lama. Coba file yang lebih sederhana." },
  duplicate: { code: "CONFLICT", message: "Dokumen yang sama sudah pernah diunggah ke acara ini." },
  quota: { code: "UNPROCESSABLE", message: "Kuota 10 dokumen aktif tercapai. Hapus dokumen lama dulu." },
};

const SUSPICIOUS: ReadonlySet<UploadRejection> = new Set(["macro", "zip_bomb", "encrypted"]);

function reject(deps: RouteDeps, reason: UploadRejection): never {
  deps.log.warn({ event: "document.upload.rejected", reason }, "upload rejected");
  if (SUSPICIOUS.has(reason)) deps.log.warn({ event: "security.upload.suspicious", reason }, "suspicious upload");
  const r = REJECTION[reason];
  throw new AppError(r.code, r.message);
}

/** Reads at most `limit` bytes of the body; more means 413, whatever Content-Length claimed. */
async function readBody(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("PAYLOAD_TOO_LARGE", REJECTION.too_large.message);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function sanitizeTitle(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
}

// POST /api/documents/upload — ARCHITECTURE §5.3 steps 1–5; step 6 (refine) is scheduled.
export function handleUpload(req: Request, deps: UploadDeps): Promise<Response> {
  return respond(deps, async () => {
    assertSameOrigin(req.headers.get("origin"), deps.appUrl, deps.log);
    const limit = MAX_FILE_BYTES + MULTIPART_OVERHEAD;
    if (Number(req.headers.get("content-length") ?? "0") > limit) reject(deps, "too_large");
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data")) throw new AppError("INVALID_INPUT", "Format unggahan tidak valid.");
    const body = await readBody(req, limit);
    let form: FormData;
    try {
      form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    } catch {
      throw new AppError("INVALID_INPUT", "Format unggahan tidak valid.");
    }
    const file = form.get("file");
    const rawTitle = form.get("title");
    const fileName = file instanceof File ? file.name : "";
    const fields = uploadFieldsSchema.safeParse({
      committeeId: form.get("committeeId"),
      title: sanitizeTitle(typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : fileName.replace(/\.[^.]*$/, "")),
    });
    if (!fields.success || !(file instanceof File)) {
      throw new AppError("INVALID_INPUT", "Lengkapi judul dan file.");
    }
    const { committeeId, title } = fields.data;

    const actor = await requireMembership(committeeId, "admin", routeGuard(deps, "POST /api/documents/upload"));
    const rl = await deps.rateLimit("upload", actor.userId);
    if (!rl.ok) throw new RateLimitedError(rl.retryAfterSeconds);

    deps.log.info(
      { event: "document.upload.received", committeeId, mimeType: file.type, sizeBytes: file.size },
      "upload received",
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateFile(fileName, file.type, bytes);
    if (!checked.ok) reject(deps, checked.reason);

    const started = performance.now();
    let text: string;
    try {
      text = await extractText(checked.kind, bytes);
    } catch (err) {
      if (err instanceof ExtractError) {
        deps.log.error({ event: "document.extract.failed", error: { code: err.reason } }, "extract failed");
        reject(deps, err.reason);
      }
      throw err;
    }
    deps.log.info(
      { event: "document.extract.completed", chars: text.length, durationMs: Math.round(performance.now() - started) },
      "extract completed",
    );

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { data: existing, error: listErr } = await deps.client
      .from("documents")
      .select("id, status, sha256")
      .eq("committee_id", committeeId);
    if (listErr) throw new Error(`document list failed: ${listErr.code}`);
    const rows = (existing ?? []) as { status: string; sha256: string }[];
    if (rows.some((d) => d.sha256 === sha256)) reject(deps, "duplicate");
    if (rows.filter((d) => d.status !== "rejected" && d.status !== "archived").length >= MAX_ACTIVE_DOCUMENTS) {
      reject(deps, "quota");
    }

    // Counts only, never values (SEC-05). The stored text is the redacted one.
    const scan = scanPii(text);
    const redacted = redact(text).text;
    deps.log.info({ event: "document.pii.scanned", summary: scan.found }, "pii scanned");

    const documentId = randomUUID();
    const storagePath = `${committeeId}/${documentId}.${checked.kind}`;
    // Insert with the admin's JWT: the 0004 policy forces internal/uploaded/version 1.
    const { error: insErr } = await deps.client.from("documents").insert({
      id: documentId,
      committee_id: committeeId,
      title,
      storage_path: storagePath,
      mime_type: checked.mime,
      size_bytes: bytes.byteLength,
      sha256,
      uploaded_by: actor.userId,
    });
    if (insErr) {
      if (insErr.code === "23505") reject(deps, "duplicate");
      throw new Error(`document insert failed: ${insErr.code}`);
    }

    const { error: upErr } = await deps.client.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: checked.mime, upsert: false });
    if (upErr) {
      await deps.client.from("documents").delete().eq("id", documentId);
      throw new Error("storage upload failed");
    }

    // Pipeline writes (system task): original_redacted version, raw PII counts, status → refining.
    const { error: vErr } = await deps.svc.from("document_versions").insert({
      document_id: documentId,
      kind: "original_redacted",
      content: redacted,
      pii_summary: scanPii(redacted).found,
    });
    if (vErr) throw new Error(`version insert failed: ${vErr.code}`);
    const { error: sErr } = await deps.svc
      .from("documents")
      .update({ pii_summary: scan.found, status: "refining", version: 2, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (sErr) throw new Error(`status update failed: ${sErr.code}`);

    await deps.audit({
      action: "document.upload",
      actorId: actor.userId,
      actorRole: actor.actorRole,
      targetType: "document",
      targetId: documentId,
      committeeId,
      outcome: "success",
      metadata: { mimeType: checked.mime, sizeBytes: bytes.byteLength, piiSummary: scan.found },
      requestId: deps.requestId,
    });

    deps.schedule(documentId);
    return NextResponse.json(
      { documentId, status: "refining", piiSummary: scan.found, requestId: deps.requestId },
      { status: 201 },
    );
  });
}

export interface StatusDeps extends RouteDeps {
  svc: SupabaseClient;
}

// GET /api/documents/[id]/status — any member of the document's committee.
export function handleStatus(documentId: string, deps: StatusDeps): Promise<Response> {
  return respond(deps, async () => {
    const g = routeGuard(deps, "GET /api/documents/[id]/status");
    await requireUser(g);
    if (!uuidSchema.safeParse(documentId).success) throw new AppError("NOT_FOUND", "Dokumen tidak ditemukan.");
    const doc = await loadDocument(deps.client, documentId, deps.log);
    await requireMembership(doc.committee_id, undefined, g);
    let { status, status_reason: statusReason, version } = doc;
    if (await failIfStale(deps.svc, doc)) {
      status = "refine_failed";
      statusReason = "timeout";
      version += 1;
      deps.log.error({ event: "document.refine.failed", documentId, error: { code: "stale" } }, "refine stale");
    }
    return NextResponse.json(
      { status, statusReason: statusReason ?? undefined, version, requestId: deps.requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

// POST /api/documents/[id]/refine — admin retry for refine_failed.
export function handleRefineRetry(req: Request, documentId: string, deps: UploadDeps): Promise<Response> {
  return respond(deps, async () => {
    assertSameOrigin(req.headers.get("origin"), deps.appUrl, deps.log);
    const g = routeGuard(deps, "POST /api/documents/[id]/refine");
    await requireUser(g);
    if (!uuidSchema.safeParse(documentId).success) throw new AppError("NOT_FOUND", "Dokumen tidak ditemukan.");
    const doc = await loadDocument(deps.client, documentId, deps.log);
    await requireMembership(doc.committee_id, "admin", g);
    const rl = await deps.rateLimit("refine", doc.committee_id); // SEC-07: per committee
    if (!rl.ok) throw new RateLimitedError(rl.retryAfterSeconds);
    if (doc.status !== "refine_failed") {
      throw new AppError("INVALID_INPUT", "Hanya dokumen yang gagal dirapikan yang bisa diulang.");
    }
    const { data, error } = await deps.svc
      .from("documents")
      .update({ status: "refining", status_reason: null, version: doc.version + 1, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("version", doc.version)
      .select("id");
    if (error) throw new Error(`retry update failed: ${error.code}`);
    if ((data ?? []).length !== 1) throw new AppError("CONFLICT");
    deps.schedule(documentId);
    return NextResponse.json({ status: "refining", requestId: deps.requestId }, { status: 202 });
  });
}
