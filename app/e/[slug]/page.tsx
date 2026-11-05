import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Window } from "@/components/ui/Window";
import { findPublicCommittee, loadPublicContext, type PublicCommitteeRow } from "@/lib/context/public";
import { formatDate } from "@/lib/format";
import { currentRequestId } from "@/lib/http/request-id.server";
import { logger } from "@/lib/log/logger";
import { slugSchema } from "@/lib/validation/chat";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "PanitiaPintar · Tanya acara" };

type Loaded =
  | { kind: "ok"; committee: PublicCommitteeRow; docCount: number; lastUpdated: string | null }
  | { kind: "error" };

async function load(slug: string): Promise<Loaded | null> {
  try {
    const committee = await findPublicCommittee(slug);
    if (!committee) return null;
    if (committee.status !== "active") return { kind: "ok", committee, docCount: 0, lastUpdated: null };
    // Same RPC as the chat route; only counts and dates are used here, content is discarded.
    const docs = await loadPublicContext(slug);
    const lastUpdated =
      docs
        .map((d) => d.updated_at)
        .sort()
        .at(-1) ?? null;
    return { kind: "ok", committee, docCount: docs.length, lastUpdated };
  } catch (err) {
    logger.error(
      {
        event: "http.request.failed",
        route: "/e/[slug]",
        error: { code: err instanceof Error ? err.name : "unknown" },
      },
      "event page load failed",
    );
    return { kind: "error" };
  }
}

export default async function EventChatPage({ params }: Props) {
  const { slug } = await params;
  if (!slugSchema.safeParse(slug).success) notFound();
  const data = await load(slug);
  if (!data) notFound();

  if (data.kind === "error") {
    return (
      <Shell>
        <Window title="PanitiaPintar">
          <ErrorState
            message="Halaman acara tidak dapat dimuat. Coba lagi nanti."
            requestId={await currentRequestId()}
          />
        </Window>
      </Shell>
    );
  }

  const { committee, docCount, lastUpdated } = data;
  const meta = [formatDate(committee.event_date), committee.location].filter(Boolean).join(" · ");

  return (
    <Shell>
      <Window title={committee.name} titleId="event-title">
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="m-0 text-base uppercase">{committee.name}</h1>
            {meta ? <p className="text-mut m-0 text-xs">{meta}</p> : null}
          </div>

          {committee.status !== "active" ? (
            <EmptyState title="Acara ini sudah selesai">
              Terima kasih sudah berpartisipasi. Narahubung: {committee.contact_public}
            </EmptyState>
          ) : docCount === 0 ? (
            <EmptyState title="Belum ada dokumen">
              Panitia belum menerbitkan informasi untuk acara ini. Narahubung: {committee.contact_public}
            </EmptyState>
          ) : (
            <ChatWindow slug={committee.slug} />
          )}

          <footer className="text-mut flex flex-col gap-0.5 text-[11px]">
            {lastUpdated ? <span>Dokumen diperbarui {formatDate(lastUpdated)}</span> : null}
            <span>Narahubung: {committee.contact_public}</span>
          </footer>
        </div>
      </Window>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 py-5">
      <PageHeader />
      {children}
    </main>
  );
}
