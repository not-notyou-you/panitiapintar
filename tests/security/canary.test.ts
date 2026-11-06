// SEC-02: a canary string in a public answer is replaced by a generic message and raised as fatal.
import { describe, expect, it } from "vitest";
import { findCanary } from "@/lib/ai/canary";
import { CANARY_MESSAGE } from "@/lib/chat/public-chat";
import { answer, COMMITTEE, REQUEST_ID, run } from "../helpers/public-chat-fixture";

describe("canary detection", () => {
  it.each([
    "Kode arsip: CANARY-INT-FT01",
    "kode canary-int-ft01 ada di dokumen",
    "CANARY INT FT01",
    "CANARY_INT_FT01",
  ])("detects %j", (text) => {
    expect(findCanary(text)).toBe("CANARY-INT-FT01");
  });

  it.each(["Tidak ada kode di sini.", "canary bird", "CANARY-INT-"])("ignores %j", (text) => {
    expect(findCanary(text)).toBeNull();
  });

  it("replaces a leaking answer, logs fatal, audits, and returns no sources", async () => {
    const { result, logs, audits, chatLogs } = await run(
      {},
      { generate: answer("Anggaran total Rp30.000.000. Kode arsip: CANARY-INT-FT01") },
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      answer: `${CANARY_MESSAGE} Hubungi narahubung: ${COMMITTEE.contact_public}`,
      answered: false,
      sources: [],
      requestId: REQUEST_ID,
    });
    const body = JSON.stringify(result.body);
    expect(body).not.toContain("CANARY");
    expect(body).not.toContain("30.000.000");

    const fatal = logs.json().find((l) => l.event === "security.canary.leaked");
    expect(fatal).toMatchObject({
      level: "fatal",
      committeeId: COMMITTEE.id,
      canaryId: "CANARY-INT-FT01",
      requestId: REQUEST_ID,
    });
    expect(audits).toEqual([
      expect.objectContaining({
        action: "security.canary_leaked",
        outcome: "failure",
        requestId: REQUEST_ID,
      }),
    ]);
    expect(chatLogs[0]).toMatchObject({ answered: false, source_doc_ids: [] });
  });

  it("does not trigger on a clean answer", async () => {
    const { result, logs, audits } = await run({}, { generate: answer("Lokasi di Aula C.") });
    expect(result.body).toMatchObject({ answered: true });
    expect(logs.json().some((l) => l.event === "security.canary.leaked")).toBe(false);
    expect(audits).toEqual([]);
  });
});
