"use client";

import { useState, useTransition } from "react";
import { requestMagicLinkAction } from "@/app/(internal)/login/actions";
import { Button } from "@/components/internal/ui/Button";

export function LoginForm({ next, initialEmail = "" }: { next?: string; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestMagicLinkAction({ email, next });
          setMsg(r.ok ? { ok: true, text: r.data.message } : { ok: false, text: r.error.message });
        });
      }}
    >
      <label className="label">
        Email panitia
        <input
          className="field"
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="nama@contoh.test"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Mengirim…" : "Kirim tautan masuk"}
      </Button>
      {msg ? (
        <p role="status" className={msg.ok ? "notice m-0" : "pii m-0"}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
