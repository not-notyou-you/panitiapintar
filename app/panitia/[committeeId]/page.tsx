import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/admin/AccessDenied";
import { AdminShell } from "@/components/admin/AdminShell";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { GeneratorPanel } from "@/components/panitia/GeneratorPanel";
import { Window } from "@/components/ui/Window";
import { pageWorkspace } from "@/lib/auth/page";
import { uuidSchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Mode Panitia" };

const TABS = [
  { key: "tanya", label: "Tanya Dokumen" },
  { key: "rundown", label: "Buat Rundown" },
  { key: "checklist", label: "Buat Checklist" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Props = { params: Promise<{ committeeId: string }>; searchParams: Promise<{ tab?: string }> };

interface MembershipRow {
  role: "admin" | "member";
  committees: { id: string; name: string; status: string } | null;
}

// INTERFACE §4.2. Only real members get in (super admins too, but only for committees they belong to).
export default async function WorkspacePage({ params, searchParams }: Props) {
  const { committeeId } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(committeeId).success) notFound();
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "tanya";

  const access = await pageWorkspace(`/panitia/${committeeId}`, committeeId);
  if (!access.ok) {
    return (
      <AdminShell>
        <AccessDenied requestId={access.requestId} />
      </AdminShell>
    );
  }
  const { client, userId, isSuperAdmin } = access.value;

  // All reads below use the user's JWT: RLS limits them to the user's own committees.
  const [{ data: committee }, { data: memberships }, { data: docs }] = await Promise.all([
    client.from("committees").select("id, name, event_date, status").eq("id", committeeId).maybeSingle(),
    client.from("memberships").select("role, committees(id, name, status)").eq("user_id", userId),
    client
      .from("documents")
      .select("id, title, visibility")
      .eq("committee_id", committeeId)
      .eq("status", "approved")
      .order("title"),
  ]);
  if (!committee) notFound();
  const mine = ((memberships ?? []) as unknown as MembershipRow[]).filter((m) => m.committees);
  const isAdmin = mine.some((m) => m.committees?.id === committeeId && m.role === "admin");

  return (
    <AdminShell superAdmin={isSuperAdmin}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-5">
          <Window title="Kepanitiaan">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {mine.map((m) => (
                <li key={m.committees!.id}>
                  <Link
                    href={`/panitia/${m.committees!.id}`}
                    className="tab block break-words"
                    aria-current={m.committees!.id === committeeId ? "page" : undefined}
                  >
                    {m.committees!.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Window>
          <Window title="Dokumen">
            {(docs ?? []).length === 0 ? (
              <p className="text-mut m-0 text-xs">Belum ada dokumen yang disetujui.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-xs">
                {(docs ?? []).map((d) => (
                  <li key={d.id as string} className="flex min-w-0 items-center gap-2">
                    <span
                      className={`badge ${d.visibility === "public" ? "badge-public" : "badge-internal"}`}
                    >
                      {d.visibility === "public" ? "PUB" : "INT"}
                    </span>
                    <span className="truncate">{d.title as string}</span>
                  </li>
                ))}
              </ul>
            )}
          </Window>
        </aside>

        <Window title={`${committee.name} · Mode Panitia`} className="min-w-0">
          <div className="flex flex-col gap-4">
            {committee.status !== "active" ? (
              <p className="pii m-0">Acara ini sudah diarsipkan. Dokumen tetap bisa ditanyakan.</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <nav className="tabs" aria-label="Alat panitia">
                {TABS.map((t) => (
                  <Link
                    key={t.key}
                    href={`/panitia/${committeeId}?tab=${t.key}`}
                    className="tab"
                    aria-current={tab === t.key ? "page" : undefined}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
              {isAdmin ? (
                <Link href={`/admin/${committeeId}`} className="btn btn-ghost no-underline">
                  Kelola acara
                </Link>
              ) : null}
            </div>
            {tab === "tanya" ? <ChatWindow committeeId={committeeId} /> : null}
            {tab === "rundown" ? (
              <GeneratorPanel
                kind="rundown"
                committeeId={committeeId}
                eventDate={committee.event_date as string | null}
              />
            ) : null}
            {tab === "checklist" ? (
              <GeneratorPanel
                kind="checklist"
                committeeId={committeeId}
                eventDate={committee.event_date as string | null}
              />
            ) : null}
          </div>
        </Window>
      </div>
    </AdminShell>
  );
}
