import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/admin/AccessDenied";
import { AdminShell } from "@/components/admin/AdminShell";
import { ArchiveButton } from "@/components/admin/ArchiveButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Window } from "@/components/ui/Window";
import { pageSuperAdmin } from "@/lib/auth/page";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Semua kepanitiaan" };

interface CommitteeRow {
  id: string;
  name: string;
  slug: string;
  event_date: string | null;
  status: string;
}

export default async function AdminHome() {
  const access = await pageSuperAdmin("/admin");
  if (!access.ok) {
    return (
      <AdminShell>
        <AccessDenied requestId={access.requestId} />
      </AdminShell>
    );
  }
  const { data } = await access.value.client
    .from("committees")
    .select("id, name, slug, event_date, status")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as CommitteeRow[];

  return (
    <AdminShell superAdmin>
      <Window title="Semua kepanitiaan">
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <Link href="/admin/new" className="btn no-underline">
              + Kepanitiaan baru
            </Link>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="Belum ada kepanitiaan" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Acara</th>
                    <th>Slug</th>
                    <th>Tanggal</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Aksi</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/admin/${c.id}`}>{c.name}</Link>
                      </td>
                      <td>
                        <code>{c.slug}</code>
                      </td>
                      <td>{formatDate(c.event_date) ?? "-"}</td>
                      <td>{c.status === "active" ? "Aktif" : "Diarsipkan"}</td>
                      <td className="text-right">
                        {c.status === "active" ? <ArchiveButton committeeId={c.id} name={c.name} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Window>
    </AdminShell>
  );
}
