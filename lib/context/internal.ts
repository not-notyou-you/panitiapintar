import "server-only";
// Mode Panitia context (ARCHITECTURE §5.2 step 6). Reads with the caller's JWT client so RLS
// (documents_member_read, versions_member_read) limits rows to the caller's own committees.
// The committee filter below narrows the query; it is not the security boundary.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextDoc } from "@/lib/ai/prompts/chat-public";

export interface InternalContextDoc extends ContextDoc {
  visibility: "public" | "internal";
}

export interface InternalContext {
  committee: { id: string; name: string; status: "active" | "archived" };
  docs: InternalContextDoc[];
}

export class InternalDataUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`internal data unavailable: ${code}`);
    this.name = "InternalDataUnavailableError";
  }
}

/** Approved documents only; uploads still under review never reach the model. Null = committee not visible. */
export async function loadInternalContext(
  client: SupabaseClient,
  committeeId: string,
): Promise<InternalContext | null> {
  const { data: committee, error: cErr } = await client
    .from("committees")
    .select("id, name, status")
    .eq("id", committeeId)
    .maybeSingle();
  if (cErr) throw new InternalDataUnavailableError(cErr.code ?? "unknown");
  if (!committee) return null;

  const { data: docs, error: dErr } = await client
    .from("documents")
    .select("id, title, visibility, current_version_id")
    .eq("committee_id", committeeId)
    .eq("status", "approved")
    .not("current_version_id", "is", null)
    .order("title");
  if (dErr) throw new InternalDataUnavailableError(dErr.code ?? "unknown");
  const rows = (docs ?? []) as {
    id: string;
    title: string;
    visibility: "public" | "internal";
    current_version_id: string;
  }[];
  if (rows.length === 0) return { committee: committee as InternalContext["committee"], docs: [] };

  const { data: versions, error: vErr } = await client
    .from("document_versions")
    .select("id, content")
    .in(
      "id",
      rows.map((r) => r.current_version_id),
    );
  if (vErr) throw new InternalDataUnavailableError(vErr.code ?? "unknown");
  const content = new Map((versions ?? []).map((v) => [v.id as string, v.content as string]));

  return {
    committee: committee as InternalContext["committee"],
    docs: rows
      .filter((r) => content.has(r.current_version_id))
      .map((r) => ({
        document_id: r.id,
        title: r.title,
        visibility: r.visibility,
        content: content.get(r.current_version_id) ?? "",
      })),
  };
}
