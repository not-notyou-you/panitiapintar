import "server-only";
// SEC-01: the ONLY read path for public mode. Uses the anon client so the database decides what is
// public (public_context filters approved + public + active). Never import the service client here;
// ESLint enforces it.
import type { ContextDoc } from "@/lib/ai/prompts/chat-public";
import { anonClient } from "@/lib/supabase/anon";

export interface PublicCommitteeRow {
  id: string;
  name: string;
  slug: string;
  event_date: string | null;
  location: string | null;
  contact_public: string;
  status: "active" | "archived";
}

export interface PublicContextDoc extends ContextDoc {
  updated_at: string;
}

export class PublicDataUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`public data unavailable: ${code}`);
    this.name = "PublicDataUnavailableError";
  }
}

// Explicit column list: anon has column-level SELECT on committees only (0004_harden §D).
const COMMITTEE_COLUMNS = "id, name, slug, event_date, location, contact_public, status";

export async function findPublicCommittee(slug: string): Promise<PublicCommitteeRow | null> {
  const { data, error } = await anonClient()
    .from("committees")
    .select(COMMITTEE_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new PublicDataUnavailableError(error.code ?? "unknown");
  return (data as PublicCommitteeRow | null) ?? null;
}

export async function listActiveCommittees(): Promise<PublicCommitteeRow[]> {
  const { data, error } = await anonClient()
    .from("committees")
    .select(COMMITTEE_COLUMNS)
    .eq("status", "active")
    .order("event_date", { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) throw new PublicDataUnavailableError(error.code ?? "unknown");
  return (data ?? []) as PublicCommitteeRow[];
}

export async function loadPublicContext(slug: string): Promise<PublicContextDoc[]> {
  const { data, error } = await anonClient().rpc("public_context", { p_slug: slug });
  if (error) throw new PublicDataUnavailableError(error.code ?? "unknown");
  return (data ?? []) as PublicContextDoc[];
}
