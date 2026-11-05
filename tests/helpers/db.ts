import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ulid } from "ulid";

export const dbAvailable = process.env.SUPABASE_AVAILABLE === "1";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export const service = (): SupabaseClient => createClient(url(), serviceKey(), noSession);
export const anon = (): SupabaseClient => createClient(url(), anonKey(), noSession);

export const requestId = () => `req_${ulid()}`;

/** Throws on a Supabase error so fixture setup fails loudly. */
export function must<R extends { data: unknown; error: { message: string } | null }>(r: R): R["data"] {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createUser(label: string, opts: { superAdmin?: boolean } = {}): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@contoh.test`;
  const password = `pw-${randomUUID()}`;
  const svc = service();
  const { user } = must(await svc.auth.admin.createUser({ email, password, email_confirm: true }));
  if (!user) throw new Error("createUser returned no user");
  must(
    await svc
      .from("profiles")
      .insert({ user_id: user.id, display_name: label, is_super_admin: !!opts.superAdmin }),
  );
  const client = createClient(url(), anonKey(), noSession);
  must(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, email, client };
}

export async function createCommittee(label: string, status: "active" | "archived" = "active") {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const row = must(
    await service()
      .from("committees")
      .insert({ name: `Acara ${label}`, slug, contact_public: "humas@contoh.test", status })
      .select("id, slug")
      .single(),
  );
  return row as { id: string; slug: string };
}

export async function addMember(userId: string, committeeId: string, role: "admin" | "member") {
  must(await service().from("memberships").insert({ user_id: userId, committee_id: committeeId, role }));
}

export interface DocInput {
  committeeId: string;
  title: string;
  visibility: "internal" | "public";
  status: "uploaded" | "refining" | "refine_failed" | "needs_review" | "approved" | "rejected" | "archived";
  content?: string;
  versionKind?: "original_redacted" | "ai_refined" | "admin_edited";
  /** Link current_version_id to the created version (approved documents always are). */
  linkVersion?: boolean;
}

/** Creates a document (+ one version) through the service role, as the pipeline would. */
export async function createDocument(input: DocInput) {
  const svc = service();
  const id = randomUUID();
  const doc = must(
    await svc
      .from("documents")
      .insert({
        id,
        committee_id: input.committeeId,
        title: input.title,
        visibility: input.visibility,
        status: input.status,
        storage_path: `${input.committeeId}/${id}.md`,
        mime_type: "text/markdown",
        size_bytes: 100,
        sha256: randomUUID(),
      })
      .select("id, version")
      .single(),
  ) as { id: string; version: number };
  const version = must(
    await svc
      .from("document_versions")
      .insert({
        document_id: id,
        kind: input.versionKind ?? "ai_refined",
        content: input.content ?? input.title,
      })
      .select("id")
      .single(),
  ) as { id: string };
  if (input.linkVersion ?? input.status === "approved") {
    must(await svc.from("documents").update({ current_version_id: version.id }).eq("id", id));
  }
  return { id, versionId: version.id, version: doc.version };
}

export async function getDocument(id: string) {
  return must(await service().from("documents").select("*").eq("id", id).single()) as Record<
    string,
    unknown
  > & {
    version: number;
    status: string;
    visibility: string;
  };
}
