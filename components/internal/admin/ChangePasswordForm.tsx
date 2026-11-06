"use client";

import { useState, useTransition } from "react";
import { changePasswordAction } from "@/app/(internal)/login/actions";
import { Button } from "@/components/internal/ui/Button";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== confirm) {
          setMsg({ ok: false, text: "Konfirmasi kata sandi tidak sama." });
          return;
        }
        start(async () => {
          const r = await changePasswordAction({ currentPassword: current, newPassword: next });
          setMsg(r.ok ? { ok: true, text: r.data.message } : { ok: false, text: r.error.message });
          setCurrent("");
          if (r.ok) {
            setNext("");
            setConfirm("");
          }
        });
      }}
    >
      <label className="label">
        Kata sandi saat ini
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="label">
        Kata sandi baru
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className="label">
        Ulangi kata sandi baru
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan kata sandi"}
      </Button>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`${msg.ok ? "notice" : "pii"} m-0`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
