"use client";

import { useState, type FormEvent } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

// INTERFACE §4.3. Output is a draft: always labelled "DRAF AI" and never saved by the server.

interface RundownRow {
  time: string;
  durationMin: number;
  activity: string;
  pic: string;
}
interface ChecklistItem {
  due: string;
  division: string;
  task: string;
}
type Result = { kind: "rundown"; rows: RundownRow[] } | { kind: "checklist"; items: ChecklistItem[] };
type Payload = Record<string, unknown>;

const CLIENT_TIMEOUT_MS = 45_000;

function toTsv(result: Result): string {
  const clean = (v: string | number) => String(v).replace(/[\t\r\n]+/g, " ");
  if (result.kind === "rundown") {
    return [
      ["Waktu", "Durasi (menit)", "Kegiatan", "PIC divisi"],
      ...result.rows.map((r) => [r.time, r.durationMin, r.activity, r.pic]),
    ]
      .map((row) => row.map(clean).join("\t"))
      .join("\n");
  }
  return [["Tenggat", "Divisi", "Tugas"], ...result.items.map((i) => [i.due, i.division, i.task])]
    .map((row) => row.map(clean).join("\t"))
    .join("\n");
}

export function GeneratorPanel({
  kind,
  committeeId,
  eventDate,
}: {
  kind: "rundown" | "checklist";
  committeeId: string;
  eventDate: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [last, setLast] = useState<Payload | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(payload: Payload) {
    setPending(true);
    setError(null);
    setCopied(false);
    setLast(payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/generate/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as {
        rows?: RundownRow[];
        items?: ChecklistItem[];
        error?: { message: string; requestId: string };
      } | null;
      if (res.ok && data && kind === "rundown" && data.rows) setResult({ kind, rows: data.rows });
      else if (res.ok && data && kind === "checklist" && data.items) setResult({ kind, items: data.items });
      else {
        setResult(null);
        setError({
          message: data?.error?.message ?? "Terjadi kesalahan. Coba lagi nanti.",
          requestId: data?.error?.requestId ?? res.headers.get("x-request-id") ?? undefined,
        });
      }
    } catch {
      setError({
        message: controller.signal.aborted
          ? "AI terlalu lama menjawab. Coba lagi."
          : "Tidak dapat terhubung. Periksa koneksi internetmu.",
      });
    } finally {
      clearTimeout(timer);
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const notes = text("notes") || undefined;
    if (kind === "rundown") {
      void run({
        committeeId,
        eventDate: text("eventDate"),
        start: text("start"),
        end: text("end"),
        activities: text("activities"),
        notes,
      });
    } else {
      const divisions = text("divisions")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
        .slice(0, 10);
      void run({
        committeeId,
        eventDate: text("eventDate"),
        divisions: divisions.length ? divisions : undefined,
        notes,
      });
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(toTsv(result));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
        <label className="label">
          Tanggal acara
          <input name="eventDate" type="date" className="field" required defaultValue={eventDate ?? ""} />
        </label>
        {kind === "rundown" ? (
          <>
            <label className="label">
              Mulai
              <input name="start" type="time" className="field" required defaultValue="09:00" />
            </label>
            <label className="label">
              Selesai
              <input name="end" type="time" className="field" required defaultValue="16:00" />
            </label>
            <label className="label sm:col-span-3">
              Isi acara
              <input
                name="activities"
                className="field"
                required
                maxLength={500}
                placeholder="Seminar, lomba UI/UX, awarding"
              />
            </label>
          </>
        ) : (
          <label className="label sm:col-span-2">
            Divisi (pisahkan dengan koma)
            <input
              name="divisions"
              className="field"
              maxLength={400}
              placeholder="Acara, Logistik, Publikasi"
            />
          </label>
        )}
        <label className="label sm:col-span-3">
          Catatan
          <input
            name="notes"
            className="field"
            maxLength={500}
            placeholder={kind === "rundown" ? "Ada ishoma 1 jam" : "Opsional"}
          />
        </label>
        <div className="sm:col-span-3 flex justify-end">
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Menyusun…" : kind === "rundown" ? "Buat draf rundown" : "Buat draf checklist"}
          </button>
        </div>
      </form>

      {error ? <ErrorState message={error.message} requestId={error.requestId} /> : null}

      {result ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="overflow-x-auto">
            {result.kind === "rundown" ? (
              <table className="table" aria-label="Draf rundown">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Durasi</th>
                    <th>Kegiatan</th>
                    <th>PIC divisi</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.time.replace(":", ".")}</td>
                      <td>{r.durationMin}&apos;</td>
                      <td>{r.activity}</td>
                      <td>{r.pic}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="table" aria-label="Draf checklist">
                <thead>
                  <tr>
                    <th>Tenggat</th>
                    <th>Divisi</th>
                    <th>Tugas</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.due}</td>
                      <td>{it.division}</td>
                      <td>{it.task}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="badge badge-review">DRAF AI · periksa sebelum dipakai</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
                {copied ? "Tersalin" : "Salin"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending || !last}
                onClick={() => last && void run(last)}
              >
                Ulangi
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
