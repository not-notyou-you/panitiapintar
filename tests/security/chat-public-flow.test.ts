// ARCHITECTURE §5.1 end to end through the handler, with fake dependencies (no Gemini, no DB).
// Covers SEC-01 (sources limited to context), SEC-05 (redaction at every stage), SEC-12 (no PII in logs).
import { describe, expect, it } from "vitest";
import { BLOCKED_MESSAGE, NO_DOCS_MESSAGE } from "@/lib/chat/public-chat";
import { publicChatRequestSchema } from "@/lib/validation/chat";
import { answer, COMMITTEE, DOCS, REQUEST_ID, run, status } from "../helpers/public-chat-fixture";

const PII = { phone: "0812-0000-9999", email: "pengunjung@contoh.test", nik: "3171000000000001" };

describe("public chat flow", () => {
  it("answers with sources limited to documents in context", async () => {
    const foreign = "00000000-0000-4000-a000-00000000ffff";
    const { result, chatLogs, logs } = await run(
      {},
      { generate: answer("Lokasi di Aula Utama Gedung C.", [DOCS[0]!.document_id, foreign]) },
    );
    expect(result).toEqual({
      status: 200,
      body: {
        answer: "Lokasi di Aula Utama Gedung C.",
        answered: true,
        sources: [{ documentId: DOCS[0]!.document_id, title: "Guidebook" }],
        requestId: REQUEST_ID,
      },
    });
    expect(chatLogs).toEqual([
      expect.objectContaining({
        committee_id: COMMITTEE.id,
        mode: "public",
        user_id: null,
        answered: true,
        source_doc_ids: [DOCS[0]!.document_id],
        request_id: REQUEST_ID,
      }),
    ]);
    const answered = logs.json().find((l) => l.event === "chat.public.answered");
    expect(answered).toMatchObject({ answered: true, sourceCount: 1, requestId: REQUEST_ID });
  });

  it("maps NOT_FOUND to 'belum tersedia' plus the official contact", async () => {
    const { result, chatLogs } = await run(
      { message: "Berapa anggaran acaranya?" },
      {
        generate: async () => ({
          status: "ok",
          value: { kind: "not_found" },
          model: "m",
          fallbackUsed: false,
        }),
      },
    );
    expect(result.body).toMatchObject({
      answer: `Informasi ini belum tersedia di dokumen panitia. Hubungi narahubung: ${COMMITTEE.contact_public}`,
      answered: false,
      sources: [],
    });
    expect(chatLogs[0]?.answered).toBe(false);
  });

  it("redacts input, history and output; no PII in prompt, logs, chat_logs or response", async () => {
    let seenPrompt = "";
    const { result, logs, chatLogs } = await run(
      {
        message: `Nomorku ${PII.phone}, emailku ${PII.email}. Lokasi di mana?`,
        history: [{ role: "user", text: `NIK ${PII.nik}` }],
      },
      {
        generate: async (input) => {
          seenPrompt = input.system + input.prompt;
          return {
            status: "ok",
            value: { kind: "answer", answer: `Hubungi ${PII.phone}.`, sourceDocIds: [] },
            model: "m",
            fallbackUsed: false,
          };
        },
      },
    );
    const everything = [seenPrompt, logs.output(), JSON.stringify(chatLogs), JSON.stringify(result.body)].join("\n");
    for (const v of Object.values(PII)) expect(everything).not.toContain(v);
    expect(result.body).toMatchObject({ answer: "Hubungi [NOMOR_HP]." });
    expect(chatLogs[0]?.question_redacted).toBe("Nomorku [NOMOR_HP], emailku [EMAIL]. Lokasi di mana?");
    expect(chatLogs[0]?.pii_types_redacted.sort()).toEqual(["email", "nik", "phone"]);
    const stages = logs
      .json()
      .filter((l) => l.event === "chat.pii.redacted")
      .map((l) => l.stage);
    expect(stages).toEqual(["input", "history", "output"]);
    // Documents and answers are never logged (CLAUDE.md rule 7).
    expect(logs.output()).not.toContain("Aula Utama");
  });

  it("returns 404 for an unknown committee", async () => {
    const { result } = await run({}, { findCommittee: async () => null });
    expect(result).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND", requestId: REQUEST_ID } } });
  });

  it("returns 404 for an archived committee without calling the AI", async () => {
    const gen = answer("x");
    const { result, logs } = await run(
      {},
      { findCommittee: async () => ({ ...COMMITTEE, status: "archived" }), generate: gen },
    );
    expect(result.status).toBe(404);
    expect(gen).not.toHaveBeenCalled();
    expect(logs.json().find((l) => l.event === "chat.public.unavailable")).toMatchObject({
      reason: "committee_archived",
    });
  });

  it("explains when there are no public documents, without calling the AI", async () => {
    const gen = answer("x");
    const { result } = await run({}, { loadContext: async () => [], generate: gen });
    expect(result.body).toMatchObject({ answer: NO_DOCS_MESSAGE, answered: false });
    expect(gen).not.toHaveBeenCalled();
  });

  it("per-IP limit returns 429 + Retry-After before any lookup", async () => {
    let looked = false;
    const { result } = await run(
      {},
      {
        rateLimit: async () => ({ ok: false, retryAfterSeconds: 42, limit: 10, window: "min" }),
        findCommittee: async () => {
          looked = true;
          return COMMITTEE;
        },
      },
    );
    expect(result).toMatchObject({ status: 429, headers: { "Retry-After": "42" } });
    expect(result.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(looked).toBe(false);
  });

  it("per-event limit returns 429", async () => {
    const { result } = await run(
      {},
      {
        rateLimit: async (bucket) =>
          bucket === "chat_public_event"
            ? { ok: false, retryAfterSeconds: 900, limit: 600, window: "hour" }
            : { ok: true },
      },
    );
    expect(result).toMatchObject({ status: 429, headers: { "Retry-After": "900" } });
  });

  it.each([
    ["rate_limited", 429, "RATE_LIMITED"],
    ["timeout", 502, "AI_UNAVAILABLE"],
    ["error", 502, "AI_UNAVAILABLE"],
    ["invalid_output", 502, "AI_UNAVAILABLE"],
  ] as const)("AI %s → %i %s", async (s, http, code) => {
    const { result, chatLogs } = await run({}, { generate: status(s) });
    expect(result.status).toBe(http);
    expect(result.body).toMatchObject({ error: { code, requestId: REQUEST_ID } });
    expect(chatLogs).toEqual([]);
  });

  it("AI blocked → friendly refusal", async () => {
    const { result } = await run({}, { generate: status("blocked") });
    expect(result.body).toMatchObject({ answer: BLOCKED_MESSAGE, answered: false });
  });

  it("a chat_logs failure still returns the answer", async () => {
    const { result, logs } = await run(
      {},
      {
        saveChatLog: async () => {
          throw new Error("db");
        },
      },
    );
    expect(result.body).toMatchObject({ answered: true });
    expect(logs.json().map((l) => l.event)).toContain("chat.log.write_failed");
  });
});

describe("public chat request schema", () => {
  const base = { slug: "festival-teknologi-fiktif", message: "Halo" };
  it.each([
    ["bad slug", { ...base, slug: "../admin" }],
    ["empty message", { ...base, message: "   " }],
    ["long message", { ...base, message: "a".repeat(1001) }],
    ["7 history turns", { ...base, history: Array.from({ length: 7 }, () => ({ role: "user", text: "x" })) }],
    ["system role", { ...base, history: [{ role: "system", text: "x" }] }],
    ["long turn", { ...base, history: [{ role: "user", text: "a".repeat(1001) }] }],
    ["unknown field", { ...base, admin: true }],
  ])("rejects %s", (_label, body) => {
    expect(publicChatRequestSchema.safeParse(body).success).toBe(false);
  });
});
