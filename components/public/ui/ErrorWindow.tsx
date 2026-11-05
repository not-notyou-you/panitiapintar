import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

/** INTERFACE §4.10: Retro Window error with the requestId the user can quote. No server-only imports. */
export function ErrorWindow({
  title,
  message,
  requestId,
  action,
}: {
  title: string;
  message: string;
  requestId?: string | null;
  action?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center gap-6 px-4 py-6">
      <section className="win" aria-labelledby="error-title" role="alert">
        <div id="error-title" className="win-title">
          <span className="diamond" aria-hidden="true" />
          <span className="truncate">{title}</span>
          <span className="win-x" aria-hidden="true">
            x
          </span>
        </div>
        <div className="flex flex-col items-start gap-3">
          <p className="m-0">{message}</p>
          {requestId ? (
            <p className="m-0 flex flex-wrap items-center gap-2 text-xs">
              Kode: <code className="select-all">{requestId}</code>
              <CopyButton value={requestId} />
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {action}
            <Link href="/" className="btn btn-ghost no-underline">
              Kembali
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
