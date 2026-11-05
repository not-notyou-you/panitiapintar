// SEC-01: public_context(slug) is the only read path for public mode.
import { beforeAll, describe, expect, it } from "vitest";
import { anon, createCommittee, createDocument, dbAvailable } from "../helpers/db";

const STATUSES = ["uploaded", "refining", "refine_failed", "needs_review", "rejected", "archived"] as const;

describe.skipIf(!dbAvailable)("public_context()", () => {
  let active: { id: string; slug: string };
  let other: { id: string; slug: string };
  let archived: { id: string; slug: string };

  beforeAll(async () => {
    [active, other, archived] = await Promise.all([
      createCommittee("pc-active"),
      createCommittee("pc-other"),
      createCommittee("pc-archived", "archived"),
    ]);
    await createDocument({
      committeeId: active.id,
      title: "PUB approved",
      visibility: "public",
      status: "approved",
    });
    await createDocument({
      committeeId: active.id,
      title: "INT approved",
      visibility: "internal",
      status: "approved",
      content: "CANARY-INT-TEST-0001",
    });
    for (const status of STATUSES) {
      await createDocument({
        committeeId: active.id,
        title: `PUB ${status}`,
        visibility: "public",
        status,
        linkVersion: true,
      });
    }
    await createDocument({
      committeeId: other.id,
      title: "OTHER pub",
      visibility: "public",
      status: "approved",
    });
    await createDocument({
      committeeId: archived.id,
      title: "ARCH pub",
      visibility: "public",
      status: "approved",
    });
  });

  const call = async (slug: string) => {
    const { data, error } = await anon().rpc("public_context", { p_slug: slug });
    expect(error).toBeNull();
    return (data ?? []) as Array<{ document_id: string; title: string; content: string }>;
  };

  it("returns only public + approved documents of that committee", async () => {
    expect((await call(active.slug)).map((d) => d.title)).toEqual(["PUB approved"]);
  });

  it("never returns internal content", async () => {
    expect(JSON.stringify(await call(active.slug))).not.toContain("CANARY-INT");
  });

  it.each(STATUSES)("excludes public documents with status %s", async (status) => {
    expect((await call(active.slug)).map((d) => d.title)).not.toContain(`PUB ${status}`);
  });

  it("does not mix committees", async () => {
    expect((await call(other.slug)).map((d) => d.title)).toEqual(["OTHER pub"]);
  });

  it("returns nothing for an archived committee", async () => {
    expect(await call(archived.slug)).toEqual([]);
  });

  it("returns nothing for an unknown or injection-shaped slug", async () => {
    expect(await call("tidak-ada")).toEqual([]);
    expect(await call("' or 1=1 --")).toEqual([]);
  });
});
