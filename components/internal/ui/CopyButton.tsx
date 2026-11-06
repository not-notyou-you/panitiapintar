"use client";

import { useState } from "react";

/** Copies a short value (requestId, a one-time temporary password). Falls back silently when the clipboard is blocked. */
export function CopyButton({ value, label = "Salin" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost px-2 py-0 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
      aria-label={`${label} ${value}`}
    >
      {done ? "Tersalin" : label}
    </button>
  );
}
