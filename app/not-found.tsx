import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Window } from "@/components/ui/Window";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-6">
      <PageHeader />
      <Window title="Tidak ditemukan">
        <EmptyState title="Halaman tidak ditemukan">
          <Link href="/" className="btn btn-ghost mt-2 inline-flex items-center no-underline">
            Lihat acara aktif
          </Link>
        </EmptyState>
      </Window>
    </main>
  );
}
