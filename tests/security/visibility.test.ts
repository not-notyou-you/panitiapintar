// SEC-04: public only when approved and the current version is free of PII; optimistic locking;
// an edit after approval goes back to review and back to internal.
import { beforeAll, describe, expect, it } from "vitest";
import { approveDocument, editApprovedDocument, setVisibility } from "@/lib/actions/documents";
import { createDocument, dbAvailable, getDocument, must, requestId, service } from "../helpers/db";
import { ctxFor, setupActors, type Actors } from "../helpers/phase2";

describe.skipIf(!dbAvailable)("visibility", () => {
  let a: Actors;
  beforeAll(async () => {
    a = await setupActors("vis");
  });

  const make = (status: "needs_review" | "approved") =>
    createDocument({ committeeId: a.A.id, title: `Dok ${status}`, visibility: "internal", status });
  const set = (documentId: string, expectedVersion: number, visibility: "public" | "internal" = "public") =>
    setVisibility({ documentId, expectedVersion, visibility }, ctxFor(a.admin.client).ctx);

  it("menolak publik saat needs_review", async () => {
    const d = await make("needs_review");
    const r = await set(d.id, d.version);
    expect(r).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect((await getDocument(d.id)).visibility).toBe("internal");
  });

  it("menolak publik saat pii_summary versi terkini tidak kosong", async () => {
    const d = await make("approved");
    must(await service().from("document_versions").update({ pii_summary: { phone: 1 } }).eq("id", d.versionId));
    const r = await set(d.id, d.version);
    expect(r).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("RPC juga menolak PII tersisa walau pengecekan aplikasi dilewati (lapis kedua)", async () => {
    const d = await make("approved");
    must(await service().from("document_versions").update({ pii_summary: { email: 2 } }).eq("id", d.versionId));
    const { error } = await a.admin.client.rpc("set_document_visibility", {
      p_doc: d.id,
      p_visibility: "public",
      p_expected_version: d.version,
      p_request_id: requestId(),
    });
    expect(error).toMatchObject({ code: "22023", message: "pii_present" });
  });

  it("konflik versi → 409 CONFLICT", async () => {
    const d = await make("approved");
    const r = await set(d.id, d.version + 5);
    expect(r).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("approved + bersih → publik, lalu edit mengembalikan ke needs_review dan internal", async () => {
    const d = await make("approved");
    const ok = await set(d.id, d.version);
    expect(ok.ok).toBe(true);
    const v = (await getDocument(d.id)).version;
    expect((await getDocument(d.id)).visibility).toBe("public");

    const edit = await editApprovedDocument(
      { documentId: d.id, expectedVersion: v, content: "## Baru\nHubungi 0812-0000-1234" },
      ctxFor(a.admin.client).ctx,
    );
    expect(edit.ok).toBe(true);
    const after = await getDocument(d.id);
    expect(after).toMatchObject({ status: "needs_review", visibility: "internal", approved_by: null });
    // The edit was redacted before storage.
    const { data } = await service().from("document_versions").select("content, kind, created_by").eq("id", edit.ok ? edit.data.versionId : "").single();
    expect(data).toMatchObject({ kind: "admin_edited", created_by: a.admin.id });
    expect(data!.content).toContain("[NOMOR_HP]");

    // Re-approve, then it can go public again.
    const re = await approveDocument({ documentId: d.id, expectedVersion: after.version }, ctxFor(a.admin.client).ctx);
    expect(re.ok).toBe(true);
    const fin = await getDocument(d.id);
    expect(fin.status).toBe("approved");
    expect((await set(d.id, fin.version)).ok).toBe(true);
  });

  it("anggota biasa tidak bisa mengubah visibilitas", async () => {
    const d = await make("approved");
    const r = await setVisibility(
      { documentId: d.id, expectedVersion: d.version, visibility: "public" },
      ctxFor(a.member.client).ctx,
    );
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
