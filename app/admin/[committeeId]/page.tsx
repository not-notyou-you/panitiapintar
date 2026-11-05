import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/admin/AccessDenied";
import { AdminShell } from "@/components/admin/AdminShell";
import { CommitteeForm } from "@/components/admin/CommitteeForm";
import { DocumentsPanel, type DocListItem } from "@/components/admin/DocumentsPanel";
import { MembersPanel, type MemberItem } from "@/components/admin/MembersPanel";
import { QrPanel } from "@/components/admin/QrPanel";
import { Window } from "@/components/ui/Window";
import { publicEventUrl } from "@/lib/api/qr";
import { pageMembership } from "@/lib/auth/page";
import { env } from "@/lib/env";
import { uuidSchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Kelola acara" };

const TABS = [
  { key: "dokumen", label: "Dokumen" },
  { key: "anggota", label: "Anggota" },
  { key: "qr", label: "QR Code" },
  { key: "pengaturan", label: "Pengaturan" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Props = { params: Promise<{ committeeId: string }>; searchParams: Promise<{ tab?: string }> };

export default async function CommitteeAdminPage({ params, searchParams }: Props) {
  const { committeeId } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(committeeId).success) notFound();
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "dokumen";

  const access = await pageMembership(`/admin/${committeeId}`, committeeId, "admin");
  if (!access.ok) {
    return (
      <AdminShell>
        <AccessDenied requestId={access.requestId} />
      </AdminShell>
    );
  }
  const { client, isSuperAdmin, userId } = access.value;
  const { data: committee } = await client
    .from("committees")
    .select("id, name, slug, event_date, location, contact_public, status")
    .eq("id", committeeId)
    .maybeSingle();
  if (!committee) notFound();

  return (
    <AdminShell superAdmin={isSuperAdmin}>
      <Window title={`${committee.name} · Kelola`}>
        <div className="flex flex-col gap-4">
          {committee.status !== "active" ? (
            <p className="pii m-0">Acara ini sudah diarsipkan. Chat publik ditutup.</p>
          ) : null}
          <nav className="tabs" aria-label="Bagian kelola acara">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/admin/${committeeId}?tab=${t.key}`}
                className="tab"
                aria-current={tab === t.key ? "page" : undefined}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {tab === "dokumen" ? <DocumentsTab committeeId={committeeId} client={client} /> : null}
          {tab === "anggota" ? <MembersTab committeeId={committeeId} client={client} selfId={userId} /> : null}
          {tab === "qr" ? <QrPanel slug={committee.slug} url={publicEventUrl(env().APP_URL, committee.slug)} /> : null}
          {tab === "pengaturan" ? (
            <CommitteeForm
              committeeId={committeeId}
              initial={{
                name: committee.name,
                slug: committee.slug,
                eventDate: committee.event_date ?? "",
                location: committee.location ?? "",
                contactPublic: committee.contact_public,
              }}
            />
          ) : null}
        </div>
      </Window>
    </AdminShell>
  );
}

type Client = Extract<Awaited<ReturnType<typeof pageMembership>>, { ok: true }>["value"]["client"];

async function DocumentsTab({ committeeId, client }: { committeeId: string; client: Client }) {
  const { data } = await client
    .from("documents")
    .select("id, title, status, visibility, version, pii_summary, status_reason, current_version_id, updated_at")
    .eq("committee_id", committeeId)
    .order("created_at", { ascending: false });
  const docs = (data ?? []) as Omit<DocListItem, "currentPii">[];
  const versionIds = docs.map((d) => d.current_version_id).filter((v): v is string => !!v);
  const { data: versions } = versionIds.length
    ? await client.from("document_versions").select("id, pii_summary").in("id", versionIds)
    : { data: [] };
  const pii = new Map((versions ?? []).map((v) => [v.id as string, v.pii_summary as Record<string, number>]));
  const items: DocListItem[] = docs.map((d) => ({
    ...d,
    currentPii: d.current_version_id ? (pii.get(d.current_version_id) ?? null) : null,
  }));
  return <DocumentsPanel committeeId={committeeId} docs={items} />;
}

async function MembersTab({ committeeId, client, selfId }: { committeeId: string; client: Client; selfId: string }) {
  const { data } = await client.rpc("committee_members", { p_committee: committeeId });
  return <MembersPanel committeeId={committeeId} members={(data ?? []) as MemberItem[]} selfId={selfId} />;
}
