import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AuditWriteError, audit } from "@/lib/log/audit";
import { captureLogger } from "../helpers/capture-logger";

function fakeClient(error: { code: string } | null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const client = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
  return { client, insert };
}

const base = {
  actorId: "11111111-1111-4111-8111-111111111111",
  actorRole: "admin" as const,
  targetType: "document" as const,
  targetId: "doc-1",
  outcome: "success" as const,
  requestId: "req_01JD3Q8Z7K2M0000000000000A",
};

describe("audit()", () => {
  it("writes a snake_case row with redacted metadata", async () => {
    const { client, insert } = fakeClient(null);
    await audit({ ...base, action: "document.upload", metadata: { note: "dari a@contoh.test" } }, { client });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.upload",
        actor_role: "admin",
        request_id: base.requestId,
        metadata: { note: "dari [EMAIL]" },
      }),
    );
  });

  it("rejects actions outside the catalog", async () => {
    const { client } = fakeClient(null);
    await expect(audit({ ...base, action: "document.hack" as never }, { client })).rejects.toThrow();
  });

  it("swallows write failures for non-critical actions but logs them", async () => {
    const { client } = fakeClient({ code: "XX000" });
    const { log, json } = captureLogger();
    await expect(audit({ ...base, action: "document.upload" }, { client, log })).resolves.toBeUndefined();
    expect(json()[0]).toMatchObject({ event: "audit.write.failed", level: "error" });
  });

  it.each(["document.approve", "document.visibility.changed"] as const)(
    "throws for critical action %s so the caller aborts",
    async (action) => {
      const { client } = fakeClient({ code: "XX000" });
      const { log } = captureLogger();
      await expect(audit({ ...base, action }, { client, log })).rejects.toBeInstanceOf(AuditWriteError);
    },
  );
});
