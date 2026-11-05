"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteDocumentAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { describePii, piiTotal, STATUS_REASON_LABELS } from "@/lib/admin/pii-labels";
import { formatDate } from "@/lib/format";
import { DocStatusBadge } from "./DocStatusBadge";
import { VisibilitySelect } from "./VisibilitySelect";

export interface DocListItem {
  id: string;
  title: string;
  status: string;
  visibility: "internal" | "public";
  version: number;
  pii_summary: Record<string, number>;
  status_reason: string | null;
  current_version_id: string | null;
  updated_at: string;
  /** Residual PII of the approved version (null when nothing is approved yet). */
  currentPii: Record<string, number> | null;
}

const MAX_DOCS = 10;
const POLL_MS = 3_000;
const POLL_MAX_MS = 120_000;

interface ApiError {
  error?: { message?: string; requestId?: string };
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiError;
  const id = body.error?.requestId ?? res.headers.get("x-request-id");
  return `${body.error?.message ?? "Terjadi kesalahan."}${id ? ` (kode ${id})` : ""}`;
}

export function DocumentsPanel({ committeeId, docs }: { committeeId: string; docs: DocListItem[] }) {
  const router = useRouter();
  const active = docs.filter((d) => d.status !== "rejected" && d.status !== "archived").length;
  const refining = docs.filter((d) => d.status === "refining").map((d) => d.id);
  usePolling(refining, () => router.refresh());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-base uppercase">
          Dokumen ({active}/{MAX_DOCS})
        </h2>
      </div>
      <UploadForm committeeId={committeeId} disabled={active >= MAX_DOCS} onDone={() => router.refresh()} />
      {docs.length === 0 ? (
        <EmptyState title="Belum ada dokumen">Unggah guidebook, rundown, atau FAQ acara.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Judul</th>
                <th>Status</th>
                <th>Visibilitas</th>
                <th>Data pribadi</th>
                <th>Diperbarui</th>
                <th>
                  <span className="sr-only">Aksi</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <DocRow key={d.id} committeeId={committeeId} doc={d} onChanged={() => router.refresh()} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocRow({ committeeId, doc, onChanged }: { committeeId: string; doc: DocListItem; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const found = piiTotal(doc.pii_summary);
  const review = `/admin/${committeeId}/documents/${doc.id}/review`;

  const retry = () =>
    start(async () => {
      const res = await fetch(`/api/documents/${doc.id}/refine`, { method: "POST" });
      if (!res.ok) setErr(await errorText(res));
      onChanged();
    });
  const remove = () => {
    if (!window.confirm(`Hapus "${doc.title}"? File dan semua versinya ikut terhapus.`)) return;
    start(async () => {
      const r = await deleteDocumentAction({ documentId: doc.id });
      if (!r.ok) setErr(`${r.error.message} (kode ${r.error.requestId})`);
      onChanged();
    });
  };

  return (
    <tr>
      <td>
        {doc.title}
        {err ? (
          <p role="alert" className="pii m-0 mt-1">
            {err}
          </p>
        ) : null}
        {doc.status === "refine_failed" || doc.status === "rejected" ? (
          <p className="text-mut m-0 text-[11px]">
            {STATUS_REASON_LABELS[doc.status_reason ?? ""] ?? null}
          </p>
        ) : null}
      </td>
      <td>
        <DocStatusBadge status={doc.status} />
      </td>
      <td>
        <VisibilitySelect doc={doc} onChanged={onChanged} />
      </td>
      <td>
        {found === 0 ? (
          <span>■ Bersih</span>
        ) : (
          <span className="text-warn" title={describePii(doc.pii_summary).join(" · ")}>
            ■ {found} disensor
          </span>
        )}
      </td>
      <td>{formatDate(doc.updated_at)}</td>
      <td className="whitespace-nowrap text-right">
        <div className="flex justify-end gap-2">
          {doc.status === "needs_review" ? (
            <Link href={review} className="btn no-underline">
              Tinjau
            </Link>
          ) : null}
          {doc.status === "approved" ? (
            <Link href={`${review}?edit=1`} className="btn btn-ghost no-underline">
              Edit
            </Link>
          ) : null}
          {doc.status === "refine_failed" ? (
            <Button onClick={retry} disabled={pending}>
              Coba lagi
            </Button>
          ) : null}
          {doc.status === "refine_failed" || doc.status === "rejected" ? (
            <Button variant="danger" onClick={remove} disabled={pending}>
              Hapus
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** Polls GET /api/documents/[id]/status every 3 s, at most 2 minutes, while documents are refining. */
function usePolling(ids: string[], onChange: () => void) {
  const key = ids.join(",");
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!key) return;
    const started = Date.now();
    const list = key.split(",");
    const timer = setInterval(async () => {
      if (Date.now() - started > POLL_MAX_MS) {
        clearInterval(timer);
        return;
      }
      for (const id of list) {
        const res = await fetch(`/api/documents/${id}/status`, { cache: "no-store" }).catch(() => null);
        if (!res?.ok) continue;
        const body = (await res.json()) as { status?: string };
        if (body.status && body.status !== "refining") {
          clearInterval(timer);
          cb.current();
          return;
        }
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [key]);
}

function UploadForm({ committeeId, disabled, onDone }: { committeeId: string; disabled: boolean; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () =>
    start(async () => {
      if (!file) return;
      const form = new FormData();
      form.set("committeeId", committeeId);
      form.set("title", title);
      form.set("file", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      if (!res.ok) {
        setMsg({ ok: false, text: await errorText(res) });
        return;
      }
      const body = (await res.json()) as { piiSummary?: Record<string, number> };
      const pii = describePii(body.piiSummary);
      setMsg({
        ok: true,
        text: pii.length
          ? `Diunggah. Disensor otomatis: ${pii.join(" · ")}. Sedang dirapikan…`
          : "Diunggah. Sedang dirapikan…",
      });
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    });

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="label flex-1">
        Judul dokumen
        <input
          className="field"
          maxLength={150}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Guidebook peserta"
        />
      </label>
      <label className="label flex-1">
        File (PDF, DOCX, TXT, MD · maks. 10 MB)
        <input
          ref={fileRef}
          className="field"
          type="file"
          name="file"
          required
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <Button type="submit" disabled={pending || disabled || !file}>
        {pending ? "Mengunggah…" : "+ Unggah dokumen"}
      </Button>
      {disabled ? <p className="text-mut m-0 text-xs">Kuota 10 dokumen aktif tercapai.</p> : null}
      {msg ? (
        <p role="status" className={`${msg.ok ? "notice" : "pii"} m-0 sm:basis-full`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
