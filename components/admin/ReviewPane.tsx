"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { approveDocumentAction, editApprovedDocumentAction, rejectDocumentAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";
import { REJECT_REASON_LABELS, STATUS_REASON_LABELS, describePii } from "@/lib/admin/pii-labels";
import type { SectionDiff } from "@/lib/documents/fact-diff";

interface ReviewDoc {
  id: string;
  status: string;
  version: number;
  visibility: string;
  statusReason: string | null;
  piiSummary: Record<string, number>;
}

/**
 * INTERFACE §4.7. Original (redacted) next to the AI result; sections whose numbers/dates do not occur
 * in the original get a yellow margin marker. Rendered as plain text, never HTML (SEC-09).
 */
export function ReviewPane(props: {
  committeeId: string;
  doc: ReviewDoc;
  original: string;
  refined: string | null;
  sections: SectionDiff[];
  startInEdit: boolean;
}) {
  const { doc, original, refined, sections, committeeId } = props;
  const router = useRouter();
  const [mobileTab, setMobileTab] = useState<"asli" | "ai">("ai");
  const [editing, setEditing] = useState(props.startInEdit);
  const [draft, setDraft] = useState(refined ?? "");
  const [reason, setReason] = useState<string>("tidak_akurat");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirmRef = useRef<HTMLDialogElement>(null);
  const flagged = sections.filter((s) => s.unknownFacts.length > 0).length;
  const censored = describePii(doc.piiSummary);
  const back = () => router.push(`/admin/${committeeId}?tab=dokumen`);
  const fail = (e: { message: string; requestId: string }) => setMsg(`${e.message} (kode ${e.requestId})`);
  const edited = editing && draft.trim() !== (refined ?? "").trim();

  const approve = () =>
    start(async () => {
      const r = await approveDocumentAction({
        documentId: doc.id,
        expectedVersion: doc.version,
        editedContent: edited ? draft : undefined,
      });
      confirmRef.current?.close();
      if (r.ok) back();
      else fail(r.error);
    });
  const reject = () =>
    start(async () => {
      const r = await rejectDocumentAction({ documentId: doc.id, expectedVersion: doc.version, reasonCategory: reason });
      if (r.ok) back();
      else fail(r.error);
    });
  const saveApprovedEdit = () =>
    start(async () => {
      const r = await editApprovedDocumentAction({ documentId: doc.id, expectedVersion: doc.version, content: draft });
      if (r.ok) router.refresh();
      else fail(r.error);
    });
  const retry = () =>
    start(async () => {
      const res = await fetch(`/api/documents/${doc.id}/refine`, { method: "POST" });
      if (res.ok) back();
      else setMsg("Gagal memulai ulang perapihan. Coba lagi nanti.");
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="tabs md:hidden" role="tablist" aria-label="Tampilan">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mobileTab === "asli"}
          aria-current={mobileTab === "asli" ? "page" : undefined}
          onClick={() => setMobileTab("asli")}
        >
          Asli
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mobileTab === "ai"}
          aria-current={mobileTab === "ai" ? "page" : undefined}
          onClick={() => setMobileTab("ai")}
        >
          Hasil AI
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={`${mobileTab === "asli" ? "" : "hidden"} md:block`} aria-labelledby="pane-original">
          <h2 id="pane-original" className="m-0 mb-2 text-sm uppercase">
            Teks asli (sudah diredaksi)
          </h2>
          <div className="pane">{original || "—"}</div>
          {censored.length > 0 ? (
            <p className="notice m-0 mt-2">■ Disensor otomatis: {censored.join(" · ")}</p>
          ) : null}
        </section>

        <section className={`${mobileTab === "ai" ? "" : "hidden"} md:block`} aria-labelledby="pane-ai">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="pane-ai" className="m-0 text-sm uppercase">
              {editing ? "Edit Markdown" : "Hasil perapihan AI"}
            </h2>
            {refined && (doc.status === "needs_review" || doc.status === "approved") ? (
              <Button variant="ghost" onClick={() => setEditing((e) => !e)}>
                {editing ? "Pratinjau" : "Edit"}
              </Button>
            ) : null}
          </div>
          {doc.status === "refine_failed" ? (
            <div className="flex flex-col items-start gap-2">
              <p className="pii m-0">
                Perapihan gagal. {STATUS_REASON_LABELS[doc.statusReason ?? ""] ?? ""}
              </p>
              <Button onClick={retry} disabled={pending}>
                Coba rapikan lagi
              </Button>
            </div>
          ) : !refined ? (
            <p className="text-mut m-0">Belum ada hasil perapihan.</p>
          ) : editing ? (
            <textarea
              className="field pane w-full font-mono"
              rows={24}
              maxLength={200_000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Isi Markdown hasil perapihan"
            />
          ) : (
            <div className="pane flex flex-col gap-3">
              {sections.map((s, i) => (
                <div key={i} className={s.unknownFacts.length ? "flagged" : undefined}>
                  {s.heading ? <p className="font-pixel m-0 uppercase">{s.heading}</p> : null}
                  <div>{s.body.trim()}</div>
                  {s.unknownFacts.length ? (
                    <p className="m-0 mt-1 text-[11px]">
                      <span className="flag-box mr-1 align-middle" aria-hidden="true" />
                      Tidak ada di teks asli: {s.unknownFacts.join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="notice m-0">
        AI bisa salah merangkum. Periksa angka, tanggal, dan lokasi.
        {flagged > 0 ? ` ${flagged} bagian diberi penanda kuning.` : ""}
      </p>
      {editing ? (
        <p className="text-mut m-0 text-xs">Hasil edit diredaksi ulang otomatis saat disimpan.</p>
      ) : null}
      {msg ? (
        <p role="alert" className="pii m-0">
          {msg}
        </p>
      ) : null}

      {doc.status === "needs_review" || doc.status === "refine_failed" ? (
        <div className="flex flex-wrap items-end justify-end gap-2">
          <label className="label">
            Alasan tolak
            <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(REJECT_REASON_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="danger" onClick={reject} disabled={pending}>
            Tolak
          </Button>
          {doc.status === "needs_review" ? (
            <Button onClick={() => confirmRef.current?.showModal()} disabled={pending || !refined}>
              Setujui
            </Button>
          ) : null}
        </div>
      ) : null}
      {doc.status === "approved" && editing ? (
        <div className="flex flex-col items-end gap-1">
          <Button onClick={saveApprovedEdit} disabled={pending || !draft.trim()}>
            Simpan &amp; kirim ke tinjauan
          </Button>
          <span className="text-mut text-[11px]">
            Dokumen kembali ke status Perlu Ditinjau
            {doc.visibility === "public" ? " dan menjadi INTERNAL sampai disetujui lagi" : ""}.
          </span>
        </div>
      ) : null}

      <dialog ref={confirmRef} className="dialog" aria-labelledby="confirm-approve">
        <div className="win-title">
          <span className="diamond" aria-hidden="true" />
          <span id="confirm-approve">Setujui dokumen?</span>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0">
            Dokumen ini akan dipakai chatbot sebagai INTERNAL. Ubah ke Publik bisa dilakukan setelahnya.
          </p>
          {edited ? <p className="notice m-0">Hasil editmu disimpan sebagai versi baru.</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => confirmRef.current?.close()}>
              Batal
            </Button>
            <Button onClick={approve} disabled={pending}>
              {pending ? "Menyimpan…" : "Setujui"}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
