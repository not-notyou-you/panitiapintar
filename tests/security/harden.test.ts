// SEC-04, SEC-13: migration 0004_harden. Documents change state only through official functions.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  anon,
  createCommittee,
  createDocument,
  createUser,
  dbAvailable,
  getDocument,
  requestId,
  service,
  type TestUser,
} from "../helpers/db";

describe.skipIf(!dbAvailable)("0004_harden", () => {
  let A: { id: string; slug: string };
  let B: { id: string; slug: string };
  let adminA: TestUser, memberA: TestUser, adminB: TestUser, superAdmin: TestUser;

  beforeAll(async () => {
    [A, B] = await Promise.all([createCommittee("hd-a"), createCommittee("hd-b")]);
    [adminA, memberA, adminB, superAdmin] = await Promise.all([
      createUser("hd-admin-a"),
      createUser("hd-member-a"),
      createUser("hd-admin-b"),
      createUser("hd-super", { superAdmin: true }),
    ]);
    await Promise.all([
      addMember(adminA.id, A.id, "admin"),
      addMember(memberA.id, A.id, "member"),
      addMember(adminB.id, B.id, "admin"),
    ]);
  });

  const review = () =>
    createDocument({
      committeeId: A.id,
      title: "Dok tinjau",
      visibility: "internal",
      status: "needs_review",
    });
  const approved = () =>
    createDocument({ committeeId: A.id, title: "Dok approved", visibility: "internal", status: "approved" });
  const auditFor = async (docId: string) =>
    (await service().from("audit_logs").select("*").eq("target_id", docId).order("id")).data ?? [];

  describe("direct UPDATE as committee admin", () => {
    it.each([
      ["visibility", { visibility: "public" }],
      ["status", { status: "approved" }],
      ["current_version_id", { current_version_id: null }],
      ["version", { version: 99 }],
      ["approved_by", { approved_by: null }],
      ["pii_summary", { pii_summary: {} }],
      ["status_reason", { status_reason: "x" }],
      ["committee_id", { committee_id: randomUUID() }],
    ])("rejects %s", async (_col, patch) => {
      const doc = await approved();
      const before = await getDocument(doc.id);
      const { error } = await adminA.client.from("documents").update(patch).eq("id", doc.id);
      expect(error?.code).toBe("42501");
      expect(await getDocument(doc.id)).toEqual(before);
    });

    it("allows renaming the title", async () => {
      const doc = await approved();
      const { error } = await adminA.client
        .from("documents")
        .update({ title: "Judul baru" })
        .eq("id", doc.id);
      expect(error).toBeNull();
      expect((await getDocument(doc.id)).title).toBe("Judul baru");
    });

    it("rejects an update that mixes title with a protected column as a whole", async () => {
      const doc = await approved();
      const { error } = await adminA.client
        .from("documents")
        .update({ title: "t", visibility: "public" })
        .eq("id", doc.id);
      expect(error).not.toBeNull();
      expect((await getDocument(doc.id)).visibility).toBe("internal");
    });

    it("the pipeline (service role) can still move status", async () => {
      const doc = await createDocument({
        committeeId: A.id,
        title: "Pipeline",
        visibility: "internal",
        status: "refining",
      });
      const { error } = await service().from("documents").update({ status: "needs_review" }).eq("id", doc.id);
      expect(error).toBeNull();
    });
  });

  describe("INSERT documents as committee admin", () => {
    const row = (over: Record<string, unknown> = {}) => ({
      committee_id: A.id,
      title: "Unggahan",
      storage_path: `${A.id}/${randomUUID()}.md`,
      mime_type: "text/markdown",
      size_bytes: 10,
      sha256: randomUUID(),
      uploaded_by: adminA.id,
      ...over,
    });

    it("accepts a plain internal upload", async () => {
      expect((await adminA.client.from("documents").insert(row())).error).toBeNull();
    });

    it.each([
      ["status approved", () => ({ status: "approved" })],
      ["visibility public", () => ({ visibility: "public" })],
      ["approved_at set", () => ({ approved_at: new Date().toISOString() })],
      ["approved_by set", () => ({ approved_by: adminA.id })],
      ["version != 1", () => ({ version: 5 })],
      ["pii_summary preset", () => ({ pii_summary: { phone: 0 } })],
      ["uploaded_by someone else", () => ({ uploaded_by: memberA.id })],
    ])("rejects %s", async (_name, over) => {
      expect((await adminA.client.from("documents").insert(row(over()))).error).not.toBeNull();
    });

    it("member cannot upload", async () => {
      expect(
        (await memberA.client.from("documents").insert(row({ uploaded_by: memberA.id }))).error,
      ).not.toBeNull();
    });
  });

  describe("INSERT document_versions", () => {
    it("admin may add their own admin_edited version", async () => {
      const doc = await review();
      const { error } = await adminA.client
        .from("document_versions")
        .insert({ document_id: doc.id, kind: "admin_edited", content: "edit", created_by: adminA.id });
      expect(error).toBeNull();
    });

    it.each(["ai_refined", "original_redacted"])("admin may not add %s", async (kind) => {
      const doc = await review();
      const { error } = await adminA.client
        .from("document_versions")
        .insert({ document_id: doc.id, kind, content: "palsu", created_by: adminA.id });
      expect(error).not.toBeNull();
    });

    it("admin may not attribute a version to someone else", async () => {
      const doc = await review();
      const { error } = await adminA.client
        .from("document_versions")
        .insert({ document_id: doc.id, kind: "admin_edited", content: "x", created_by: memberA.id });
      expect(error).not.toBeNull();
    });

    it("admin of B may not add versions to A's document", async () => {
      const doc = await review();
      const { error } = await adminB.client
        .from("document_versions")
        .insert({ document_id: doc.id, kind: "admin_edited", content: "x", created_by: adminB.id });
      expect(error).not.toBeNull();
    });
  });

  describe("approve_document()", () => {
    it("approves, bumps version, and audits with request_id", async () => {
      const doc = await review();
      const rid = requestId();
      const { data, error } = await adminA.client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: doc.versionId,
        p_expected_version: doc.version,
        p_request_id: rid,
      });
      expect(error).toBeNull();
      expect(data).toBe(doc.version + 1);
      const after = await getDocument(doc.id);
      expect(after).toMatchObject({
        status: "approved",
        current_version_id: doc.versionId,
        approved_by: adminA.id,
      });
      const [entry] = await auditFor(doc.id);
      expect(entry).toMatchObject({
        action: "document.approve",
        request_id: rid,
        actor_id: adminA.id,
        outcome: "success",
      });
      expect(entry.metadata).toEqual({ edited: false, versionId: doc.versionId });
    });

    it("rejects a version_id that belongs to another document", async () => {
      const doc = await review();
      const otherDoc = await review();
      const { error } = await adminA.client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: otherDoc.versionId,
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.message).toBe("invalid_version");
      expect((await getDocument(doc.id)).status).toBe("needs_review");
    });

    it("rejects an original_redacted version", async () => {
      const doc = await createDocument({
        committeeId: A.id,
        title: "Mentah",
        visibility: "internal",
        status: "needs_review",
        versionKind: "original_redacted",
      });
      const { error } = await adminA.client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: doc.versionId,
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.message).toBe("invalid_version");
    });

    it("returns conflict on a stale expected_version", async () => {
      const doc = await review();
      const { error } = await adminA.client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: doc.versionId,
        p_expected_version: doc.version - 1,
        p_request_id: requestId(),
      });
      expect(error?.code).toBe("40001");
      expect(await auditFor(doc.id)).toEqual([]);
    });

    it("rejects an illegal transition (already approved)", async () => {
      const doc = await approved();
      const { error } = await adminA.client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: doc.versionId,
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.message).toBe("invalid_transition");
    });

    it.each([
      ["member of A", () => memberA],
      ["admin of B", () => adminB],
    ])("forbids %s", async (_who, who) => {
      const doc = await review();
      const { error } = await who().client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: doc.versionId,
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.code).toBe("42501");
      expect((await getDocument(doc.id)).status).toBe("needs_review");
    });

    it("rejects a missing or malformed request id", async () => {
      const doc = await review();
      const { error } = await adminA.client.rpc("approve_document", {
        p_doc: doc.id,
        p_version_id: doc.versionId,
        p_expected_version: doc.version,
        p_request_id: "abc",
      });
      expect(error?.message).toBe("invalid_request_id");
    });
  });

  describe("reject_document()", () => {
    it("rejects with a category and audits", async () => {
      const doc = await review();
      const rid = requestId();
      const { error } = await adminA.client.rpc("reject_document", {
        p_doc: doc.id,
        p_reason_category: "inaccurate",
        p_expected_version: doc.version,
        p_request_id: rid,
      });
      expect(error).toBeNull();
      expect(await getDocument(doc.id)).toMatchObject({ status: "rejected", status_reason: "inaccurate" });
      expect((await auditFor(doc.id))[0]).toMatchObject({ action: "document.reject", request_id: rid });
    });

    it("refuses free-text reasons", async () => {
      const doc = await review();
      const { error } = await adminA.client.rpc("reject_document", {
        p_doc: doc.id,
        p_reason_category: "hubungi 0812-0000-1234",
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.message).toBe("invalid_reason");
    });

    it("returns conflict on a stale expected_version", async () => {
      const doc = await review();
      const { error } = await adminA.client.rpc("reject_document", {
        p_doc: doc.id,
        p_reason_category: "inaccurate",
        p_expected_version: doc.version + 1,
        p_request_id: requestId(),
      });
      expect(error?.code).toBe("40001");
    });
  });

  describe("set_document_visibility()", () => {
    it("publishes an approved document and audits with request_id", async () => {
      const doc = await approved();
      const rid = requestId();
      const { data, error } = await adminA.client.rpc("set_document_visibility", {
        p_doc: doc.id,
        p_visibility: "public",
        p_expected_version: doc.version,
        p_request_id: rid,
      });
      expect(error).toBeNull();
      expect(data).toBe(doc.version + 1);
      const [entry] = await auditFor(doc.id);
      expect(entry).toMatchObject({
        action: "document.visibility.changed",
        request_id: rid,
        actor_role: "admin",
      });
      expect(entry.metadata).toEqual({ from: "internal", to: "public" });
    });

    it("super admin may change visibility, audited as super_admin", async () => {
      const doc = await approved();
      const { error } = await superAdmin.client.rpc("set_document_visibility", {
        p_doc: doc.id,
        p_visibility: "public",
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error).toBeNull();
      expect((await auditFor(doc.id))[0]).toMatchObject({ actor_role: "super_admin" });
    });

    it("refuses to publish a document that is not approved", async () => {
      const doc = await review();
      const { error } = await adminA.client.rpc("set_document_visibility", {
        p_doc: doc.id,
        p_visibility: "public",
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.message).toBe("not_approved");
    });

    it("returns conflict on a stale expected_version", async () => {
      const doc = await approved();
      const args = { p_doc: doc.id, p_visibility: "public", p_expected_version: doc.version };
      expect(
        (await adminA.client.rpc("set_document_visibility", { ...args, p_request_id: requestId() })).error,
      ).toBeNull();
      const { error } = await adminA.client.rpc("set_document_visibility", {
        ...args,
        p_visibility: "internal",
        p_request_id: requestId(),
      });
      expect(error?.code).toBe("40001");
      expect((await getDocument(doc.id)).visibility).toBe("public");
    });

    it("member cannot change visibility", async () => {
      const doc = await approved();
      const { error } = await memberA.client.rpc("set_document_visibility", {
        p_doc: doc.id,
        p_visibility: "public",
        p_expected_version: doc.version,
        p_request_id: requestId(),
      });
      expect(error?.code).toBe("42501");
    });

    it("the old 3-argument signature no longer exists", async () => {
      const doc = await approved();
      const { error } = await adminA.client.rpc("set_document_visibility", {
        p_doc: doc.id,
        p_visibility: "public",
        p_expected_version: doc.version,
      });
      expect(error).not.toBeNull();
      expect((await getDocument(doc.id)).visibility).toBe("internal");
    });
  });

  describe("function privileges", () => {
    const docArgs = { p_doc: randomUUID(), p_expected_version: 1, p_request_id: requestId() };
    it.each([
      ["approve_document", { ...docArgs, p_version_id: randomUUID() }],
      ["reject_document", { ...docArgs, p_reason_category: "x" }],
      ["set_document_visibility", { ...docArgs, p_visibility: "public" }],
      ["rate_limit_hit", { p_bucket: "x", p_window_seconds: 60, p_max: 10 }],
      ["purge_expired_logs", { p_chat_days: 0, p_ai_days: 0, p_audit_days: 0 }],
    ])("anon cannot execute %s", async (fn, args) => {
      const { error } = await anon().rpc(fn, args);
      expect(error?.code).toBe("42501");
    });

    it.each([
      ["rate_limit_hit", { p_bucket: "x", p_window_seconds: 60, p_max: 10 }],
      ["purge_expired_logs", { p_chat_days: 0, p_ai_days: 0, p_audit_days: 0 }],
    ])("authenticated cannot execute %s", async (fn, args) => {
      const { error } = await memberA.client.rpc(fn, args);
      expect(error?.code).toBe("42501");
    });

    it.each(["doc_rpc_actor_role", "documents_guard_protected_columns"])(
      "helper %s is not callable",
      async (fn) => {
        const { error } = await adminA.client.rpc(
          fn,
          fn === "doc_rpc_actor_role" ? { p_committee: A.id } : {},
        );
        expect(error).not.toBeNull();
      },
    );

    it("service role still runs rate_limit_hit", async () => {
      const { data, error } = await service().rpc("rate_limit_hit", {
        p_bucket: `t:${randomUUID()}`,
        p_window_seconds: 60,
        p_max: 1,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  });

  describe("committees column privileges", () => {
    it("anon reads the public columns", async () => {
      const { data, error } = await anon()
        .from("committees")
        .select("id, name, slug, event_date, location, contact_public, status")
        .eq("id", A.id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it.each(["created_by", "created_at", "*"])("anon select %s is denied", async (col) => {
      const { error } = await anon().from("committees").select(col).eq("id", A.id);
      expect(error?.code).toBe("42501");
    });
  });
});
