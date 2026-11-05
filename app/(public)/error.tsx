"use client";

import { useEffect, useState } from "react";
import { ErrorWindow } from "@/components/public/ui/ErrorWindow";
import { requestIdFromDocument } from "@/lib/http/request-id.client";

// Route-level error boundary. The error itself is never shown (CLAUDE.md rule 8): the server already
// logged it with the same requestId.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => setRequestId(requestIdFromDocument()), []);
  return (
    <ErrorWindow
      title="Terjadi kesalahan"
      message="Coba lagi beberapa saat lagi."
      requestId={requestId}
      action={
        <button type="button" className="btn" onClick={reset}>
          Coba lagi
        </button>
      }
    />
  );
}
