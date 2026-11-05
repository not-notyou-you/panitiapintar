import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/internal/ui/PageHeader";

/** Logged-in frame: header, navigation, logout (POST, same origin: SEC-11). */
export function AdminShell({ children, superAdmin = false }: { children: ReactNode; superAdmin?: boolean }) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader subtitle="Ruang panitia" />
        <nav className="flex flex-wrap items-center gap-2" aria-label="Navigasi panitia">
          <Link href="/panitia" className="tab">
            Kepanitiaanku
          </Link>
          {superAdmin ? (
            <>
              <Link href="/admin" className="tab">
                Semua acara
              </Link>
              <Link href="/admin/logs" className="tab">
                Log
              </Link>
            </>
          ) : null}
          <form action="/auth/logout" method="post">
            <button type="submit" className="btn btn-ghost">
              Keluar
            </button>
          </form>
        </nav>
      </div>
      {children}
    </main>
  );
}
