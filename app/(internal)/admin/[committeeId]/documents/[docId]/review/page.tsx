import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/internal/admin/AccessDenied";
import { AdminShell } from "@/components/internal/admin/AdminShell";
import { DocStatusBadge } from "@/components/internal/admin/DocStatusBadge";
import { ReviewPane } from "@/components/internal/admin/ReviewPane";
import { Window } from "@/components/internal/ui/Window";
import { latestReviewVersion } from "@/lib/actions/documents";
import { DOCUMENT_COLUMNS, type DocumentRow } from "@/lib/api/respond";
import { pageMembership } from "@/lib/auth/page";
import { diffFacts } from "@/lib/documents/fact-diff";
import { uuidSchema } from "@/lib/validation/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Tinjau dokumen" };

type Props = {
  params: Promise<{ committeeId: string; docId: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export default async function ReviewPage({ params, searchParams }: Props) {
  const { committeeId, docId } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(committeeId).success || !uuidSchema.safeParse(docId).success) notFound();

  const route = `/admin/${committeeId}/documents/${docId}/review`;
  const access = await pageMembership(route, committeeId, "admin");
  if (!access.ok) {
    return (
      <AdminShell>
        <AccessDenied requestId={access.requestId} />
      </AdminShell>
    );
  }
  const { client, isSuperAdmin } = access.value;
  // committee_id filter: a document id from another committee in this URL is simply not found.
  const { data } = await client
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", docId)
    .eq("committee_id", committeeId)
    .maybeSingle();
  if (!data) notFound();
  const doc = data as DocumentRow;

  const { data: original } = await client
    .from("document_versions")
    .select("content")
    .eq("document_id", docId)
    .eq("kind", "original_redacted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latest = await latestReviewVersion(client, docId);
  // For an approved document, edit the approved text, not a newer unapproved draft.
  let refined = latest;
  if (doc.status === "approved" && doc.current_version_id && latest?.id !== doc.current_version_id) {
    const { data: cur } = await client
      .from("document_versions")
      .select("id, kind, content, pii_summary, created_at")
      .eq("id", doc.current_version_id)
      .maybeSingle();
    refined = cur ?? latest;
  }
  const originalText = (original?.content as string | undefined) ?? "";
  const sections = refined ? diffFacts(originalText, refined.content) : [];

  return (
    <AdminShell superAdmin={isSuperAdmin}>
      <Window title={`Tinjau: ${doc.title}`}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/admin/${committeeId}?tab=dokumen`}>← Dokumen</Link>
            <DocStatusBadge status={doc.status} />
          </div>
          <ReviewPane
            committeeId={committeeId}
            doc={{
              id: doc.id,
              status: doc.status,
              version: doc.version,
              visibility: doc.visibility,
              statusReason: doc.status_reason,
              piiSummary: doc.pii_summary,
            }}
            original={originalText}
            refined={refined?.content ?? null}
            sections={sections}
            startInEdit={sp.edit === "1" && doc.status === "approved"}
          />
        </div>
      </Window>
    </AdminShell>
  );
}
