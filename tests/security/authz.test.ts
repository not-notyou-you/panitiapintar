// SEC-03: every route handler and server action, called as anon / member / admin of another committee /
// admin / super admin. Documents of another committee are invisible through RLS, so a foreign admin gets
// NOT_FOUND there (no existence leak); everywhere else non-members get FORBIDDEN.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { archiveCommittee, createCommittee, updateCommittee } from "@/lib/actions/committees";
import {
  approveDocument,
  deleteDocument,
  editApprovedDocument,
  rejectDocument,
  setVisibility,
} from "@/lib/actions/documents";
import { changeMemberRole, inviteMember, removeMember } from "@/lib/actions/members";
import type { ActionResult } from "@/lib/actions/runtime";
import { handleRefineRetry, handleStatus, handleUpload } from "@/lib/api/documents";
import { handleQr } from "@/lib/api/qr";
import {
  addMember,
  anon,
  createCommittee as dbCommittee,
  createDocument,
  createUser,
  dbAvailable,
  must,
  service,
} from "../helpers/db";
import { ORIGIN, ctxFor, setupActors, uploadDeps, uploadRequest, type Actors } from "../helpers/phase2";

type ActorKey = "anon" | "member" | "otherAdmin" | "admin" | "superAdmin";
const ACTORS: ActorKey[] = ["anon", "member", "otherAdmin", "admin", "superAdmin"];
type Outcome = "ok" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";

const ADMIN_ONLY: Record<ActorKey, Outcome> = {
  anon: "UNAUTHENTICATED",
  member: "FORBIDDEN",
  otherAdmin: "FORBIDDEN",
  admin: "ok",
  superAdmin: "ok",
};
const ADMIN_DOC: Record<ActorKey, Outcome> = { ...ADMIN_ONLY, otherAdmin: "NOT_FOUND" };
const SUPER_ONLY: Record<ActorKey, Outcome> = {
  anon: "UNAUTHENTICATED",
  member: "FORBIDDEN",
  otherAdmin: "FORBIDDEN",
  admin: "FORBIDDEN",
  superAdmin: "ok",
};
const MEMBER_DOC: Record<ActorKey, Outcome> = { ...ADMIN_DOC, member: "ok" };

const HTTP: Record<Outcome, number[]> = {
  ok: [200, 201, 202],
  UNAUTHENTICATED: [401],
  FORBIDDEN: [403],
  NOT_FOUND: [404],
};

function outcomeOf(r: ActionResult<unknown>): string {
  return r.ok ? "ok" : r.error.code;
}

async function outcomeOfResponse(res: Response): Promise<string> {
  if (res.ok) return "ok";
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return body.error?.code ?? String(res.status);
}

describe.skipIf(!dbAvailable)("authz matrix", () => {
  let a: Actors;
  let clients: Record<ActorKey, SupabaseClient>;
  beforeAll(async () => {
    a = await setupActors("az");
    clients = {
      anon: anon(),
      member: a.member.client,
      otherAdmin: a.otherAdmin.client,
      admin: a.admin.client,
      superAdmin: a.superAdmin.client,
    };
  });

  const doc = (status: "needs_review" | "approved" | "refine_failed") =>
    createDocument({ committeeId: a.A.id, title: `az ${status}`, visibility: "internal", status });

  // Each case prepares fresh fixtures per actor so one actor's success never changes another's result.
  const actionCases: [string, Record<ActorKey, Outcome>, (c: SupabaseClient) => Promise<ActionResult<unknown>>][] = [
    [
      "createCommittee",
      SUPER_ONLY,
      (c) =>
        createCommittee(
          { name: "Acara Matriks", slug: `az-${randomUUID().slice(0, 8)}`, contactPublic: "@resmi" },
          ctxFor(c).ctx,
        ),
    ],
    [
      "updateCommittee",
      ADMIN_ONLY,
      (c) =>
        updateCommittee(
          { committeeId: a.A.id, name: `Acara A ${randomUUID().slice(0, 4)}`, contactPublic: "@resmi" },
          ctxFor(c).ctx,
        ),
    ],
    [
      "archiveCommittee",
      SUPER_ONLY,
      async (c) => {
        const target = await dbCommittee("az-arch");
        return archiveCommittee({ committeeId: target.id }, ctxFor(c).ctx);
      },
    ],
    [
      "approveDocument",
      ADMIN_DOC,
      async (c) => {
        const d = await doc("needs_review");
        return approveDocument({ documentId: d.id, expectedVersion: d.version }, ctxFor(c).ctx);
      },
    ],
    [
      "rejectDocument",
      ADMIN_DOC,
      async (c) => {
        const d = await doc("needs_review");
        return rejectDocument({ documentId: d.id, expectedVersion: d.version, reasonCategory: "lainnya" }, ctxFor(c).ctx);
      },
    ],
    [
      "editApprovedDocument",
      ADMIN_DOC,
      async (c) => {
        const d = await doc("approved");
        return editApprovedDocument({ documentId: d.id, expectedVersion: d.version, content: "## Edit" }, ctxFor(c).ctx);
      },
    ],
    [
      "setVisibility",
      ADMIN_DOC,
      async (c) => {
        const d = await doc("approved");
        return setVisibility({ documentId: d.id, expectedVersion: d.version, visibility: "public" }, ctxFor(c).ctx);
      },
    ],
    [
      "deleteDocument",
      ADMIN_DOC,
      async (c) => {
        const d = await doc("refine_failed");
        return deleteDocument({ documentId: d.id }, ctxFor(c).ctx);
      },
    ],
    [
      "inviteMember",
      ADMIN_ONLY,
      async (c) => {
        const u = await createUser("az-inv");
        return inviteMember({ committeeId: a.A.id, email: u.email, role: "member" }, ctxFor(c).ctx, async () => ({
          userId: u.id,
          invited: false,
        }));
      },
    ],
    [
      "changeMemberRole",
      ADMIN_ONLY,
      async (c) => {
        const u = await createUser("az-role");
        await addMember(u.id, a.A.id, "member");
        return changeMemberRole({ committeeId: a.A.id, userId: u.id, role: "admin" }, ctxFor(c).ctx);
      },
    ],
    [
      "removeMember",
      ADMIN_ONLY,
      async (c) => {
        const u = await createUser("az-rm");
        await addMember(u.id, a.A.id, "member");
        return removeMember({ committeeId: a.A.id, userId: u.id }, ctxFor(c).ctx);
      },
    ],
  ];

  describe.each(actionCases)("action %s", (_name, expected, call) => {
    it.each(ACTORS)("as %s", async (actor) => {
      expect(outcomeOf(await call(clients[actor]))).toBe(expected[actor]);
    });
  });

  const routeCases: [string, Record<ActorKey, Outcome>, (c: SupabaseClient) => Promise<Response>][] = [
    [
      "POST /api/documents/upload",
      ADMIN_ONLY,
      async (c) => {
        // Other cases pile documents onto A; archive them so the 10-document quota does not interfere.
        must(await service().from("documents").update({ status: "archived" }).eq("committee_id", a.A.id).select("id"));
        return handleUpload(
          uploadRequest({
            committeeId: a.A.id,
            title: "az",
            file: { name: "az.txt", type: "text/plain", bytes: new TextEncoder().encode(`az ${randomUUID()}`) },
          }),
          uploadDeps(c),
        );
      },
    ],
    [
      "GET /api/documents/[id]/status",
      MEMBER_DOC,
      async (c) => {
        const d = await doc("needs_review");
        return handleStatus(d.id, { ...uploadDeps(c), svc: service() });
      },
    ],
    [
      "POST /api/documents/[id]/refine",
      ADMIN_DOC,
      async (c) => {
        const d = await doc("refine_failed");
        return handleRefineRetry(new Request("http://x", { method: "POST", headers: { origin: ORIGIN } }), d.id, uploadDeps(c));
      },
    ],
    [
      "GET /api/qr/[slug]",
      ADMIN_ONLY,
      (c) => handleQr(a.A.slug, new URLSearchParams("format=svg"), uploadDeps(c)),
    ],
  ];

  describe.each(routeCases)("route %s", (_name, expected, call) => {
    it.each(ACTORS)("as %s", async (actor) => {
      const res = await call(clients[actor]);
      const outcome = await outcomeOfResponse(res);
      expect(outcome).toBe(expected[actor]);
      expect(HTTP[expected[actor]]).toContain(res.status);
    });
  });

  it("member of B cannot read anything of A through RLS directly", async () => {
    await doc("approved");
    const c = a.otherAdmin.client;
    expect(must(await c.from("documents").select("id").eq("committee_id", a.A.id))).toEqual([]);
    expect(must(await c.from("memberships").select("user_id").eq("committee_id", a.A.id))).toEqual([]);
    const { error } = await c.rpc("committee_members", { p_committee: a.A.id });
    expect(error?.code).toBe("42501");
    const { data: files } = await c.storage.from("documents-raw").list(a.A.id);
    expect(files ?? []).toEqual([]);
  });

  it("denials are audited with outcome=denied", async () => {
    const d = await doc("approved");
    const { ctx } = ctxFor(a.member.client);
    await setVisibility({ documentId: d.id, expectedVersion: d.version, visibility: "public" }, ctx);
    const { data } = await service().from("audit_logs").select("action, outcome, actor_id").eq("request_id", ctx.requestId);
    expect(data).toEqual([{ action: "auth.access_denied", outcome: "denied", actor_id: a.member.id }]);
  });
});
