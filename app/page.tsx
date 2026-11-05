import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Window } from "@/components/ui/Window";
import { listActiveCommittees, type PublicCommitteeRow } from "@/lib/context/public";
import { formatDate } from "@/lib/format";
import { currentRequestId } from "@/lib/http/request-id.server";
import { logger } from "@/lib/log/logger";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let committees: PublicCommitteeRow[] | null = null;
  try {
    committees = await listActiveCommittees();
  } catch (err) {
    logger.error(
      { event: "http.request.failed", route: "/", error: { code: err instanceof Error ? err.name : "unknown" } },
      "home load failed",
    );
  }
  const requestId = committees === null ? await currentRequestId() : null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-6 sm:px-7">
      <PageHeader subtitle="Tanya jawab acara kampus dari dokumen resmi panitia" />
      <Window title="Acara aktif">
        {committees === null ? (
          <ErrorState message="Daftar acara tidak dapat dimuat. Coba lagi nanti." requestId={requestId} />
        ) : committees.length === 0 ? (
          <EmptyState title="Belum ada acara aktif">Acara yang sedang berjalan akan tampil di sini.</EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {committees.map((c) => (
              <li key={c.id}>
                <Link href={`/e/${c.slug}`} className="chip text-tx flex flex-col gap-1 no-underline">
                  <span className="font-pixel text-sm uppercase">{c.name}</span>
                  <span className="text-mut text-xs">
                    {[formatDate(c.event_date), c.location].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Window>
    </main>
  );
}
