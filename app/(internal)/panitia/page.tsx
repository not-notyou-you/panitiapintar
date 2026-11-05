import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/internal/admin/AdminShell";
import { EmptyState } from "@/components/internal/ui/EmptyState";
import { Window } from "@/components/internal/ui/Window";
import { pageUser } from "@/lib/auth/page";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Kepanitiaanku" };

interface Row {
  role: "admin" | "member";
  committees: { id: string; name: string; slug: string; event_date: string | null; status: string } | null;
}

export default async function PanitiaHome() {
  const access = await pageUser("/panitia");
  if (!access.ok) return null;
  const { client, userId, isSuperAdmin } = access.value;
  // RLS: a user reads only their own memberships.
  const { data } = await client
    .from("memberships")
    .select("role, committees(id, name, slug, event_date, status)")
    .eq("user_id", userId);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.committees);

  return (
    <AdminShell superAdmin={isSuperAdmin}>
      <Window title="Kepanitiaanku">
        {rows.length === 0 ? (
          <EmptyState title="Belum terdaftar di kepanitiaan">
            Minta admin kepanitiaan mengundang emailmu.
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Acara</th>
                <th>Peran</th>
                <th>Tanggal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.committees!.id}>
                  <td>
                    {r.committees!.name}
                    {r.committees!.status !== "active" ? (
                      <span className="text-mut"> (diarsipkan)</span>
                    ) : null}
                  </td>
                  <td>{r.role === "admin" ? "Admin" : "Anggota"}</td>
                  <td>{formatDate(r.committees!.event_date) ?? "-"}</td>
                  <td className="text-right">
                    <span className="inline-flex gap-3">
                      <Link href={`/panitia/${r.committees!.id}`}>Buka</Link>
                      {r.role === "admin" ? <Link href={`/admin/${r.committees!.id}`}>Kelola</Link> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Window>
    </AdminShell>
  );
}
