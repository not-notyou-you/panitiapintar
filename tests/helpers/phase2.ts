import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionCtx } from "@/lib/actions/runtime";
import type { UploadDeps } from "@/lib/api/documents";
import { audit } from "@/lib/log/audit";
import { captureLogger } from "./capture-logger";
import { addMember, anon, createCommittee, createUser, requestId, service, type TestUser } from "./db";

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
export const ORIGIN = new URL(APP_URL).origin;

/** The five actors of the authz matrix (TESTING §2), around committee A. */
export interface Actors {
  A: { id: string; slug: string };
  B: { id: string; slug: string };
  member: TestUser;
  otherAdmin: TestUser; // admin of B only
  admin: TestUser; // admin of A
  coAdmin: TestUser; // second admin of A (keeps "last admin" tests independent)
  superAdmin: TestUser;
}

export async function setupActors(label: string): Promise<Actors> {
  const [A, B] = await Promise.all([createCommittee(`${label}-a`), createCommittee(`${label}-b`)]);
  const [member, otherAdmin, admin, coAdmin, superAdmin] = await Promise.all([
    createUser(`${label}-member`),
    createUser(`${label}-other`),
    createUser(`${label}-admin`),
    createUser(`${label}-coadmin`),
    createUser(`${label}-super`, { superAdmin: true }),
  ]);
  await Promise.all([
    addMember(member.id, A.id, "member"),
    addMember(admin.id, A.id, "admin"),
    addMember(coAdmin.id, A.id, "admin"),
    addMember(otherAdmin.id, B.id, "admin"),
  ]);
  return { A, B, member, otherAdmin, admin, coAdmin, superAdmin };
}

export function ctxFor(client: SupabaseClient, opts: { origin?: string | null } = {}) {
  const { log, lines, json } = captureLogger();
  const ctx: ActionCtx = {
    client,
    requestId: requestId(),
    log,
    origin: opts.origin === undefined ? ORIGIN : opts.origin,
    appUrl: APP_URL,
    audit: (entry) => audit(entry, { log, client: service() }),
  };
  return { ctx, lines, json };
}

export const anonCtx = (opts?: { origin?: string | null }) => ctxFor(anon(), opts);

export function uploadDeps(client: SupabaseClient, scheduled: string[] = []): UploadDeps & { lines: string[] } {
  const { ctx, lines } = ctxFor(client);
  return {
    client,
    log: ctx.log,
    requestId: ctx.requestId,
    appUrl: APP_URL,
    audit: ctx.audit,
    svc: service(),
    rateLimit: async () => ({ ok: true }),
    schedule: (id) => scheduled.push(id),
    lines,
  };
}

export function uploadRequest(
  fields: { committeeId: string; title?: string; file?: { name: string; type: string; bytes: Uint8Array } },
  opts: { origin?: string | null } = {},
): Request {
  const form = new FormData();
  form.set("committeeId", fields.committeeId);
  if (fields.title !== undefined) form.set("title", fields.title);
  if (fields.file) {
    form.set("file", new File([new Uint8Array(fields.file.bytes)], fields.file.name, { type: fields.file.type }));
  }
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  return new Request(`${APP_URL}/api/documents/upload`, { method: "POST", body: form, headers });
}

export { DOCX_MIME, PNG_BYTES, makeDocx, makePdf } from "./files";
