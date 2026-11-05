"use client";

import "./base.css";
import "./(public)/public.css";
import { ErrorWindow } from "@/components/public/ui/ErrorWindow";

// Replaces the root layout when it fails, so it renders its own <html>. The layout (and its request-id
// meta) is gone here; Next's digest is the only correlation handle and is safe to show.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="id">
      <body>
        <div data-area="public">
          <ErrorWindow
            title="Terjadi kesalahan"
            message="Coba lagi beberapa saat lagi."
            requestId={error.digest ? `digest:${error.digest}` : null}
          />
        </div>
      </body>
    </html>
  );
}
