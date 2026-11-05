// SEC-13 / CLAUDE.md rule 10: approval, rejection, visibility, edit-after-approve and committee archive
// write audit_logs with the request id in the same transaction; a failed audit insert cancels the action;
// audit rows are append-only.
import { beforeAll, describe, expect, it } from "vitest";
import { archiveCommittee, createCommittee } from "@/lib/actions/committees";
import { approveDocument, rejectDocument, setVisibility } from "@/lib/actions/documents";
import { changeMemberRole, inviteMember } from "@/lib/actions/members";
import { createDocument, createUser, dbAvailable, getDocument, service } from "../helpers/db";
import { ctxFor, setupActors, type Actors } from "../helpers/phase2";

const auditRows = async (targetId: string) =>
  (await service().from("audit_logs").select("*").eq("target_id", targetId).order("id")).data ?? [];

describe.skipIf(!dbAvailable)("audit_logs", () => {
  let a: Actors;
  beforeAll(async () => {
    a = await setupActors("aud");
  });

  it("approve dan ubah visibilitas menulis audit dengan request_id", async () => {
    const d = await createDocument({ committeeId: a.A.id, title: "Aud", visibility: "internal", status: "needs_review" });
    const c1 = ctxFor(a.admin.client).ctx;
    const r1 = await approveDocument({ documentId: d.id, expectedVersion: d.version }, c1);
    expect(r1.ok).toBe(true);
    const v = (await getDocument(d.id)).version;
    const c2 = ctxFor(a.admin.client).ctx;
    expect((await setVisibility({ documentId: d.id, expectedVersion: v, visibility: "public" }, c2)).ok).toBe(true);
    const rows = await auditRows(d.id);
    expect(rows.map((r) => [r.action, r.request_id, r.actor_id])).toEqual([
      ["document.approve", c1.requestId, a.admin.id],
      ["document.visibility.changed", c2.requestId, a.admin.id],
    ]);
    expect(rows[1]!.metadata).toEqual({ from: "internal", to: "public" });
  });

  it("reject menulis audit dengan kategori alasan", async () => {
    const d = await createDocument({ committeeId: a.A.id, title: "Rej", visibility: "internal", status: "needs_review" });
    const r = await rejectDocument({ documentId: d.id, expectedVersion: d.version, reasonCategory: "tidak_akurat" }, ctxFor(a.admin.client).ctx);
    expect(r.ok).toBe(true);
    expect((await auditRows(d.id)).map((x) => [x.action, x.metadata.reasonCategory])).toEqual([
      ["document.reject", "tidak_akurat"],
    ]);
  });

  it("gagal menulis audit = aksi dibatalkan (transaksi RPC)", async () => {
    const d = await createDocument({ committeeId: a.A.id, title: "Rollback", visibility: "internal", status: "needs_review" });
    // A request id the audit check refuses makes the RPC raise before commit: nothing may change.
    const ctx = ctxFor(a.admin.client).ctx;
    const bad = { ...ctx, requestId: "bukan-request-id" };
    const r = await approveDocument({ documentId: d.id, expectedVersion: d.version }, bad);
    expect(r.ok).toBe(false);
    expect(await getDocument(d.id)).toMatchObject({ status: "needs_review", version: d.version });
    expect(await auditRows(d.id)).toEqual([]);
  });

  it("buat & arsipkan kepanitiaan tercatat", async () => {
    const slug = `aud-new-${Date.now().toString(36)}`;
    const created = await createCommittee(
      { name: "Acara Audit", slug, contactPublic: "@resmi" },
      ctxFor(a.superAdmin.client).ctx,
    );
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data.committeeId : "";
    expect((await archiveCommittee({ committeeId: id }, ctxFor(a.superAdmin.client).ctx)).ok).toBe(true);
    expect((await auditRows(id)).map((r) => r.action)).toEqual(["committee.create", "committee.archive"]);
  });

  it("undang & ubah peran anggota tercatat tanpa email mentah", async () => {
    const invitee = await createUser("aud-invitee");
    const { ctx, lines } = ctxFor(a.admin.client);
    const r = await inviteMember({ committeeId: a.A.id, email: invitee.email, role: "member" }, ctx, async () => ({
      userId: invitee.id,
      invited: false,
    }));
    expect(r.ok).toBe(true);
    expect(lines.join("\n")).not.toContain(invitee.email);
    expect(lines.join("\n")).toContain('"emailHash"');
    const rc = await changeMemberRole({ committeeId: a.A.id, userId: invitee.id, role: "admin" }, ctxFor(a.admin.client).ctx);
    expect(rc.ok).toBe(true);
    const rows = await auditRows(invitee.id);
    expect(rows.map((x) => x.action)).toEqual(["membership.add", "membership.role_change"]);
    expect(JSON.stringify(rows)).not.toContain(invitee.email);
  });

  it("UPDATE ke audit_logs ditolak (append-only)", async () => {
    const { data } = await service().from("audit_logs").select("id").limit(1).single();
    const { error } = await service().from("audit_logs").update({ outcome: "failure" }).eq("id", data!.id);
    expect(error?.message).toContain("append-only");
  });
});
