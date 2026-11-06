"use client";

import { useState, useTransition } from "react";
import { signInAction } from "@/app/(internal)/login/actions";
import { Button } from "@/components/internal/ui/Button";

export function LoginForm({
  next,
  initialEmail = "",
  initialPassword = "",
}: {
  next?: string;
  initialEmail?: string;
  /** Local test accounts only (login page passes it outside production). */
  initialPassword?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await signInAction({ email, password, next });
          if (r.ok) {
            // Full navigation so every server component re-renders with the new session cookie.
            window.location.assign(r.data.next);
            return;
          }
          setPassword("");
          setError(r.error.message);
        });
      }}
    >
      <label className="label">
        Email panitia
        <input
          className="field"
          type="email"
          name="email"
          autoComplete="username"
          required
          maxLength={254}
          placeholder="nama@contoh.test"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="label">
        Kata sandi
        <input
          className="field"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={200}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Memeriksa…" : "Masuk"}
      </Button>
      {error ? (
        <p role="alert" className="pii m-0">
          {error}
        </p>
      ) : null}
    </form>
  );
}
