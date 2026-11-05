"use client";

import { useRef, useState, useTransition } from "react";
import { setVisibilityAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";
import { describePii, piiTotal } from "@/lib/admin/pii-labels";
import { VisibilityBadge } from "./DocStatusBadge";

interface Doc {
  id: string;
  title: string;
  status: string;
  visibility: "internal" | "public";
  version: number;
  pii_summary: Record<string, number>;
  currentPii: Record<string, number> | null;
}

/**
 * INTERFACE §4.5/§4.6: only approved documents can change visibility; going public always passes
 * through the dialog, and there is no "public without redaction" button while PII remains.
 */
export function VisibilitySelect({ doc, onChanged }: { doc: Doc; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const approved = doc.status === "approved";
  const residual = piiTotal(doc.currentPii);
  const censored = describePii(doc.pii_summary);

  const apply = (visibility: "internal" | "public") =>
    start(async () => {
      setErr(null);
      const r = await setVisibilityAction({ documentId: doc.id, visibility, expectedVersion: doc.version });
      if (!r.ok) {
        setErr(`${r.error.message} (kode ${r.error.requestId})`);
        return;
      }
      dialog.current?.close();
      onChanged();
    });

  return (
    <div className="flex flex-col gap-1">
      <select
        className="field"
        aria-label={`Visibilitas ${doc.title}`}
        value={doc.visibility}
        disabled={!approved || pending}
        title={approved ? undefined : "Setujui dokumen dulu"}
        onChange={(e) => {
          const next = e.target.value as "internal" | "public";
          if (next === "public") dialog.current?.showModal();
          else apply("internal");
        }}
      >
        <option value="internal">INTERNAL</option>
        <option value="public">PUBLIK</option>
      </select>
      {!approved ? <span className="text-mut text-[11px]">Setujui dokumen dulu</span> : null}
      {err && !dialog.current?.open ? (
        <span role="alert" className="text-warn text-[11px]">
          {err}
        </span>
      ) : null}

      <dialog ref={dialog} className="dialog" aria-labelledby={`vis-${doc.id}`}>
        <div className="win-title">
          <span className="diamond" aria-hidden="true" />
          <span id={`vis-${doc.id}`}>Jadikan &quot;{doc.title}&quot; PUBLIK?</span>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0">Dokumen ini akan bisa dibaca chatbot publik dan dijawab ke siapa saja.</p>
          {residual > 0 ? (
            <p className="pii m-0">
              ■ {residual} pola data pribadi masih terlihat: {describePii(doc.currentPii).join(" · ")}. Edit dan
              redaksi dulu sebelum dijadikan Publik.
            </p>
          ) : censored.length > 0 ? (
            <p className="notice m-0">Data pribadi di file asli sudah disensor otomatis: {censored.join(" · ")}.</p>
          ) : (
            <p className="notice m-0">Tidak ditemukan pola data pribadi.</p>
          )}
          {err ? (
            <p role="alert" className="pii m-0">
              {err}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Batal
            </Button>
            {residual === 0 ? (
              <Button onClick={() => apply("public")} disabled={pending}>
                {pending ? "Menyimpan…" : "Jadikan Publik"}
              </Button>
            ) : null}
          </div>
        </div>
      </dialog>
      <span className="sr-only">
        Saat ini: <VisibilityBadge visibility={doc.visibility} />
      </span>
    </div>
  );
}
