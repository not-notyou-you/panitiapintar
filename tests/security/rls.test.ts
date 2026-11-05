// SEC-01, SEC-03, SEC-13: row level security as the last layer.
import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  anon,
  createCommittee,
  createDocument,
  createUser,
  dbAvailable,
  getDocument,
  service,
  type TestUser,
} from "../helpers/db";

describe.skipIf(!dbAvailable)("RLS", () => {
  let A: { id: string; slug: string };
  let B: { id: string; slug: string };
  let adminA: TestUser, memberA: TestUser, adminB: TestUser, outsider: TestUser, superAdmin: TestUser;
  let docA: { id: string; versionId: string; version: number };
  let docB: { id: string; versionId: string; version: number };

  beforeAll(async () => {
    [A, B] = await Promise.all([createCommittee("rls-a"), createCommittee("rls-b")]);
    [adminA, memberA, adminB, outsider, superAdmin] = await Promise.all([
      createUser("admin-a"),
      createUser("member-a"),
      createUser("admin-b"),
      createUser("outsider"),
      createUser("super", { superAdmin: true }),
    ]);
    await Promise.all([
      addMember(adminA.id, A.id, "admin"),
      addMember(memberA.id, A.id, "member"),
      addMember(adminB.id, B.id, "admin"),
    ]);
    [docA, docB] = await Promise.all([
      createDocument({ committeeId: A.id, title: "Anggaran A", visibility: "internal", status: "approved" }),
      createDocument({ committeeId: B.id, title: "Anggaran B", visibility: "internal", status: "approved" }),
    ]);
    await createDocument({
      committeeId: A.id,
      title: "Guidebook A",
      visibility: "public",
      status: "approved",
    });
  });

  describe("anon", () => {
    it.each([
      "documents",
      "document_versions",
      "memberships",
      "profiles",
      "chat_logs",
      "audit_logs",
      "ai_calls",
    ])("selects 0 rows from %s", async (table) => {
      const { data, error } = await anon().from(table).select("*").limit(5);
      // Either RLS hides every row or the table is not readable at all.
      expect(error ? [] : data).toEqual([]);
    });

    it("cannot insert documents", async () => {
      const { error } = await anon()
        .from("documents")
        .insert({
          committee_id: A.id,
          title: "x",
          storage_path: "x",
          mime_type: "text/plain",
          size_bytes: 1,
          sha256: "x",
        });
      expect(error).not.toBeNull();
    });

    it("cannot write audit_logs", async () => {
      const { error } = await anon()
        .from("audit_logs")
        .insert({ actor_role: "system", action: "x", target_type: "system", outcome: "success" });
      expect(error).not.toBeNull();
    });
  });

  describe("cross-committee isolation", () => {
    it("member of A reads A's internal documents", async () => {
      const { data } = await memberA.client.from("documents").select("id").eq("id", docA.id);
      expect(data).toHaveLength(1);
    });

    it("member of A reads 0 rows of B's documents", async () => {
      const { data } = await memberA.client.from("documents").select("id").eq("committee_id", B.id);
      expect(data).toEqual([]);
    });

    it("member of A reads 0 rows of B's document_versions", async () => {
      const { data } = await memberA.client.from("document_versions").select("id").eq("document_id", docB.id);
      expect(data).toEqual([]);
    });

    it("admin of B cannot see A's memberships", async () => {
      const { data } = await adminB.client.from("memberships").select("user_id").eq("committee_id", A.id);
      expect(data).toEqual([]);
    });

    it("outsider sees no documents at all", async () => {
      const { data } = await outsider.client.from("documents").select("id");
      expect(data).toEqual([]);
    });

    it("admin of B cannot delete A's document", async () => {
      await adminB.client.from("documents").delete().eq("id", docA.id);
      expect((await getDocument(docA.id)).id).toBe(docA.id);
    });

    it("super admin reads every committee's documents", async () => {
      const { data } = await superAdmin.client.from("documents").select("id").in("id", [docA.id, docB.id]);
      expect(data).toHaveLength(2);
    });
  });

  describe("roles inside a committee", () => {
    it("member cannot update visibility", async () => {
      const { error } = await memberA.client
        .from("documents")
        .update({ visibility: "public" })
        .eq("id", docA.id);
      expect(error).not.toBeNull();
      expect((await getDocument(docA.id)).visibility).toBe("internal");
    });

    it("member cannot add memberships", async () => {
      const { error } = await memberA.client
        .from("memberships")
        .insert({ user_id: outsider.id, committee_id: A.id, role: "admin" });
      expect(error).not.toBeNull();
    });

    it("user cannot promote themself to super admin", async () => {
      await memberA.client.from("profiles").update({ is_super_admin: true }).eq("user_id", memberA.id);
      const { data } = await service()
        .from("profiles")
        .select("is_super_admin")
        .eq("user_id", memberA.id)
        .single();
      expect(data?.is_super_admin).toBe(false);
    });

    it("admin reads chat_logs; member does not", async () => {
      await service().from("chat_logs").insert({
        committee_id: A.id,
        mode: "public",
        question_redacted: "dimana lokasi?",
        answered: true,
        request_id: "req_test",
      });
      expect((await adminA.client.from("chat_logs").select("id").eq("committee_id", A.id)).data).toHaveLength(
        1,
      );
      expect((await memberA.client.from("chat_logs").select("id").eq("committee_id", A.id)).data).toEqual([]);
    });

    it("only super admin reads audit_logs and ai_calls", async () => {
      expect((await adminA.client.from("audit_logs").select("id").limit(1)).data).toEqual([]);
      expect((await adminA.client.from("ai_calls").select("id").limit(1)).data).toEqual([]);
      expect((await superAdmin.client.from("audit_logs").select("id").limit(1)).error).toBeNull();
    });
  });

  describe("append-only logs", () => {
    it("UPDATE on audit_logs fails even for the service role", async () => {
      const row = await service()
        .from("audit_logs")
        .insert({
          actor_role: "system",
          action: "system.retention_purge",
          target_type: "system",
          outcome: "success",
        })
        .select("id")
        .single();
      const { error } = await service()
        .from("audit_logs")
        .update({ outcome: "failure" })
        .eq("id", row.data?.id);
      expect(error?.message).toMatch(/append-only/);
    });

    it("UPDATE on ai_calls fails even for the service role", async () => {
      const row = await service()
        .from("ai_calls")
        .insert({
          request_id: "req_test",
          purpose: "chat_public",
          model: "m",
          status: "ok",
          latency_ms: 1,
          prompt_sha256: "x",
        })
        .select("id")
        .single();
      const { error } = await service().from("ai_calls").update({ status: "error" }).eq("id", row.data?.id);
      expect(error?.message).toMatch(/append-only/);
    });

    it("purge_expired_logs runs for the service role", async () => {
      const { data, error } = await service().rpc("purge_expired_logs", {
        p_chat_days: 30,
        p_ai_days: 90,
        p_audit_days: 180,
      });
      expect(error).toBeNull();
      expect(data).toMatchObject({ chat_logs: expect.any(Number), audit_logs: expect.any(Number) });
    });
  });
});
