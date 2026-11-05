"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import { createCommitteeAction, updateCommitteeAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";

export interface CommitteeValues {
  name: string;
  slug: string;
  eventDate: string;
  location: string;
  contactPublic: string;
}

const EMPTY: CommitteeValues = { name: "", slug: "", eventDate: "", location: "", contactPublic: "" };

/** FR-A1. New committee (super admin) or edit (committee admin; slug is fixed after creation). */
export function CommitteeForm({ committeeId, initial }: { committeeId?: string; initial?: CommitteeValues }) {
  const router = useRouter();
  const [v, setV] = useState<CommitteeValues>(initial ?? EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof CommitteeValues) => (e: ChangeEvent<HTMLInputElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const submit = () =>
    start(async () => {
      if (committeeId) {
        const r = await updateCommitteeAction({
          committeeId,
          name: v.name,
          eventDate: v.eventDate,
          location: v.location,
          contactPublic: v.contactPublic,
        });
        setMsg(r.ok ? { ok: true, text: "Perubahan disimpan." } : { ok: false, text: r.error.message });
        if (r.ok) router.refresh();
      } else {
        const r = await createCommitteeAction(v);
        if (r.ok) router.push(`/admin/${r.data.committeeId}`);
        else setMsg({ ok: false, text: r.error.message });
      }
    });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="label">
        Nama acara
        <input
          className="field"
          required
          minLength={3}
          maxLength={120}
          value={v.name}
          onChange={set("name")}
        />
      </label>
      <label className="label">
        {committeeId ? "Slug (alamat /e/…, tidak bisa diubah)" : "Slug (alamat /e/…)"}
        <input
          className="field"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          minLength={3}
          maxLength={60}
          value={v.slug}
          onChange={set("slug")}
          disabled={!!committeeId}
          placeholder="festival-contoh-2026"
        />
      </label>
      <label className="label">
        Tanggal acara
        <input className="field" type="date" value={v.eventDate} onChange={set("eventDate")} />
      </label>
      <label className="label">
        Lokasi
        <input className="field" maxLength={200} value={v.location} onChange={set("location")} />
      </label>
      <label className="label">
        Narahubung resmi (bukan nomor pribadi)
        <input
          className="field"
          required
          maxLength={200}
          value={v.contactPublic}
          onChange={set("contactPublic")}
          placeholder="@akun_resmi_acara"
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : committeeId ? "Simpan perubahan" : "Buat kepanitiaan"}
      </Button>
      {msg ? (
        <p role="status" className={msg.ok ? "notice m-0" : "pii m-0"}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
