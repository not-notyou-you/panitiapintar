// SEC-11: every mutation (route handler or server action) rejects a foreign or missing Origin with 403
// and logs security.csrf.blocked, before doing any work, even for a fully authorised super admin.
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as chatPublic } from "@/app/api/chat/public/route";
import { POST as logout } from "@/app/auth/logout/route";
import { requestMagicLink } from "@/lib/actions/auth";
import { archiveCommittee, createCommittee, updateCommittee } from "@/lib/actions/committees";
import {
  approveDocument,
  deleteDocument,
  editApprovedDocument,
  rejectDocument,
  setVisibility,
} from "@/lib/actions/documents";
import { changeMemberRole, inviteMember, removeMember } from "@/lib/actions/members";
import type { ActionCtx, ActionResult } from "@/lib/actions/runtime";
import { handleRefineRetry, handleUpload } from "@/lib/api/documents";
import { createDocument, dbAvailable, getDocument } from "../helpers/db";
import { APP_URL, ctxFor, setupActors, uploadDeps, uploadRequest, type Actors } from "../helpers/phase2";

const FOREIGN = "https://jahat.contoh.test";
const BAD_ORIGINS: [string, string | null][] = [
  ["asing", FOREIGN],
  ["kosong", null],
  ["beda port", "http://localhost:9999"],
];
const UUID = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!dbAvailable)("CSRF / Origin", () => {
  let a: Actors;
  let docId: string;
  let docVersion: number;
  beforeAll(async () => {
    a = await setupActors("csrf");
    const d = await createDocument({
      committeeId: a.A.id,
      title: "csrf",
      visibility: "internal",
      status: "approved",
    });
    docId = d.id;
    docVersion = d.version;
  });

  const actions: [string, (ctx: ActionCtx) => Promise<ActionResult<unknown>>][] = [
    ["createCommittee", (c) => createCommittee({ name: "Acara X", slug: "csrf-x", contactPublic: "@x" }, c)],
    [
      "updateCommittee",
      (c) => updateCommittee({ committeeId: a.A.id, name: "Acara Y", contactPublic: "@x" }, c),
    ],
    ["archiveCommittee", (c) => archiveCommittee({ committeeId: a.A.id }, c)],
    ["approveDocument", (c) => approveDocument({ documentId: docId, expectedVersion: docVersion }, c)],
    [
      "rejectDocument",
      (c) => rejectDocument({ documentId: docId, expectedVersion: docVersion, reasonCategory: "lainnya" }, c),
    ],
    [
      "editApprovedDocument",
      (c) => editApprovedDocument({ documentId: docId, expectedVersion: docVersion, content: "x" }, c),
    ],
    [
      "setVisibility",
      (c) => setVisibility({ documentId: docId, expectedVersion: docVersion, visibility: "public" }, c),
    ],
    ["deleteDocument", (c) => deleteDocument({ documentId: docId }, c)],
    [
      "inviteMember",
      (c) =>
        inviteMember({ committeeId: a.A.id, email: "x@contoh.test", role: "member" }, c, async () => {
          throw new Error("must not be reached");
        }),
    ],
    [
      "changeMemberRole",
      (c) => changeMemberRole({ committeeId: a.A.id, userId: a.member.id, role: "admin" }, c),
    ],
    ["removeMember", (c) => removeMember({ committeeId: a.A.id, userId: a.member.id }, c)],
    [
      "requestMagicLink",
      (c) =>
        requestMagicLink({ email: "x@contoh.test" }, c, {
          ipHash: "test",
          rateLimit: async () => {
            throw new Error("must not be reached");
          },
        }),
    ],
  ];

  describe.each(BAD_ORIGINS)("Origin %s", (_label, origin) => {
    it.each(actions)("action %s → FORBIDDEN", async (_name, call) => {
      const { ctx, lines } = ctxFor(a.superAdmin.client, { origin });
      const r = await call(ctx);
      expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(lines.join("\n")).toContain("security.csrf.blocked");
    });

    it("POST /api/documents/upload → 403", async () => {
      const deps = uploadDeps(a.superAdmin.client);
      const res = await handleUpload(
        uploadRequest(
          {
            committeeId: a.A.id,
            title: "x",
            file: { name: "x.txt", type: "text/plain", bytes: new TextEncoder().encode("x") },
          },
          { origin },
        ),
        deps,
      );
      expect(res.status).toBe(403);
      expect(deps.lines.join("\n")).toContain("security.csrf.blocked");
    });

    it("POST /api/documents/[id]/refine → 403", async () => {
      const headers: Record<string, string> = origin ? { origin } : {};
      const res = await handleRefineRetry(
        new Request("http://x", { method: "POST", headers }),
        UUID,
        uploadDeps(a.superAdmin.client),
      );
      expect(res.status).toBe(403);
    });

    it("POST /api/chat/public → 403", async () => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const res = await chatPublic(
        new NextRequest(`${APP_URL}/api/chat/public`, {
          method: "POST",
          headers,
          body: JSON.stringify({ slug: a.A.slug, message: "halo" }),
        }),
        undefined,
      );
      expect(res.status).toBe(403);
    });

    it("POST /auth/logout → 403", async () => {
      const headers: Record<string, string> = origin ? { origin } : {};
      const res = await logout(
        new NextRequest(`${APP_URL}/auth/logout`, { method: "POST", headers }),
        undefined,
      );
      expect(res.status).toBe(403);
    });
  });

  it("nothing changed after all rejected attempts", async () => {
    expect(await getDocument(docId)).toMatchObject({
      status: "approved",
      visibility: "internal",
      version: docVersion,
    });
  });
});
