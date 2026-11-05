// ROADMAP 1.1: timeout, retry, fallback, 429, blocked, invalid output — all with a mocked transport.
import { describe, expect, it, vi } from "vitest";
import { createAiClient } from "@/lib/ai/client";
import { parseChatPublicOutput } from "@/lib/ai/prompts/chat-public";
import { AiTransportError, type AiTransport, type TransportResponse } from "@/lib/ai/types";
import type { AiCallRow } from "@/lib/ai/with-ai-logging";
import { captureLogger } from "../helpers/capture-logger";

type Step = TransportResponse | Error | "hang";

function scripted(steps: Step[]) {
  const calls: string[] = [];
  const transport: AiTransport = {
    generate: vi.fn(async ({ model, signal }) => {
      calls.push(model);
      const step = steps.shift() ?? new Error("script exhausted");
      if (step === "hang") {
        return new Promise<TransportResponse>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }
      if (step instanceof Error) throw step;
      return step;
    }),
  };
  return { transport, calls };
}

const ok = (answer = "Lokasi di Aula C.", ids: string[] = ["d1"]): TransportResponse => ({
  text: JSON.stringify({ answer, source_doc_ids: ids }),
  inputTokens: 100,
  outputTokens: 20,
});

function setup(steps: Step[], opts: { fallback?: string } = { fallback: "model-fallback" }) {
  const { transport, calls } = scripted(steps);
  const rows: AiCallRow[] = [];
  const sleep = vi.fn(async () => {});
  const client = createAiClient({
    transport,
    models: { chat: "model-chat", refine: "model-refine", fallback: opts.fallback },
    timeoutMs: 30,
    write: async (row) => {
      rows.push(row);
    },
    sleep,
    random: () => 0.5,
  });
  const cap = captureLogger("debug");
  const run = () =>
    client.generate({
      purpose: "chat_public",
      role: "chat",
      system: "SYSTEM",
      prompt: "PROMPT",
      parse: parseChatPublicOutput,
      requestId: "req_01JD0000000000000000000000",
      committeeId: "00000000-0000-4000-a000-000000000001",
      contextDocIds: ["d1"],
      log: cap.log,
    });
  const events = () => cap.json().map((l) => l.event as string);
  return { run, calls, rows, sleep, events, cap };
}

describe("ai client", () => {
  it("returns parsed output and writes one ai_calls row", async () => {
    const t = setup([ok()]);
    const res = await t.run();
    expect(res).toMatchObject({ status: "ok", model: "model-chat", fallbackUsed: false });
    expect(res.status === "ok" && res.value).toEqual({
      kind: "answer",
      answer: "Lokasi di Aula C.",
      sourceDocIds: ["d1"],
    });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({
      request_id: "req_01JD0000000000000000000000",
      status: "ok",
      attempt: 1,
      input_tokens: 100,
      context_doc_ids: ["d1"],
    });
    expect(t.rows[0].prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.events()).toEqual(["ai.call.started", "ai.call.succeeded"]);
  });

  it("times out, retries once with backoff, then succeeds", async () => {
    const t = setup(["hang", ok()]);
    const res = await t.run();
    expect(res.status).toBe("ok");
    expect(t.calls).toEqual(["model-chat", "model-chat"]);
    expect(t.sleep).toHaveBeenCalledOnce();
    expect(t.sleep.mock.calls[0]).toEqual([600]); // 400 base + 0.5 * 400 jitter
    expect(t.rows.map((r) => [r.status, r.attempt])).toEqual([
      ["timeout", 1],
      ["ok", 2],
    ]);
    expect(t.events()).toContain("ai.call.timeout");
    expect(t.events()).toContain("ai.call.retried");
  });

  it("falls back to the fallback model after two 5xx", async () => {
    const t = setup([new AiTransportError(503, "http_503"), new AiTransportError(500, "http_500"), ok()]);
    const res = await t.run();
    expect(res).toMatchObject({ status: "ok", model: "model-fallback", fallbackUsed: true });
    expect(t.calls).toEqual(["model-chat", "model-chat", "model-fallback"]);
    expect(t.rows.map((r) => r.fallback_used)).toEqual([false, false, true]);
    expect(t.events()).toContain("ai.call.fallback");
  });

  it("reports timeout when every attempt on every model times out", async () => {
    const t = setup(["hang", "hang", "hang", "hang"]);
    const res = await t.run();
    expect(res.status).toBe("timeout");
    expect(t.calls).toHaveLength(4);
  });

  it("does not retry or fall back on 429", async () => {
    const t = setup([new AiTransportError(429, "http_429")]);
    const res = await t.run();
    expect(res.status).toBe("rate_limited");
    expect(t.calls).toEqual(["model-chat"]);
    expect(t.sleep).not.toHaveBeenCalled();
    expect(t.events()).toContain("ai.call.rate_limited");
    expect(t.rows[0]).toMatchObject({ status: "rate_limited", error_code: "http_429" });
  });

  it("maps a safety block to blocked without retry", async () => {
    const t = setup([{ text: "", blockReason: "SAFETY" }]);
    const res = await t.run();
    expect(res.status).toBe("blocked");
    expect(t.calls).toHaveLength(1);
    expect(t.cap.json().find((l) => l.event === "ai.call.blocked")).toMatchObject({ blockReason: "SAFETY" });
  });

  it("maps unparseable output to invalid_output with paths only", async () => {
    const t = setup([{ text: JSON.stringify({ answer: 42, secret: "leak" }) }]);
    const res = await t.run();
    expect(res.status).toBe("invalid_output");
    expect(t.calls).toHaveLength(1);
    const line = t.cap.json().find((l) => l.event === "ai.output.invalid");
    expect(line?.validationErrors).toEqual(["answer"]);
    expect(t.cap.output()).not.toContain("leak");
  });

  it("does not retry a non-5xx client error", async () => {
    const t = setup([new AiTransportError(400, "http_400")]);
    expect((await t.run()).status).toBe("error");
    expect(t.calls).toHaveLength(1);
  });

  it("without a fallback model, stops after the retry", async () => {
    const t = setup([new AiTransportError(500, "http_500"), new AiTransportError(500, "http_500")], {});
    expect((await t.run()).status).toBe("error");
    expect(t.calls).toEqual(["model-chat", "model-chat"]);
  });

  it("never logs or stores prompt text", async () => {
    const t = setup([ok()]);
    await t.run();
    expect(t.cap.output()).not.toContain("PROMPT");
    expect(JSON.stringify(t.rows)).not.toContain("PROMPT");
  });

  it("a failing ai_calls write does not fail the call", async () => {
    const { transport } = scripted([ok()]);
    const cap = captureLogger();
    const client = createAiClient({
      transport,
      models: { chat: "m", refine: "r" },
      write: async () => {
        throw new Error("db down");
      },
    });
    const res = await client.generate({
      purpose: "chat_public",
      role: "chat",
      system: "s",
      prompt: "p",
      parse: parseChatPublicOutput,
      requestId: "req_x",
      log: cap.log,
    });
    expect(res.status).toBe("ok");
    expect(cap.json().map((l) => l.event)).toContain("ai.calls.write_failed");
  });
});

describe("parseChatPublicOutput", () => {
  it.each([
    ["NOT_FOUND", { kind: "not_found" }],
    ['{"answer":"NOT_FOUND","source_doc_ids":[]}', { kind: "not_found" }],
    ['```json\n{"answer":"Ya.","source_doc_ids":["a"]}\n```', { kind: "answer", answer: "Ya.", sourceDocIds: ["a"] }],
    ['{"answer":"Ya."}', { kind: "answer", answer: "Ya.", sourceDocIds: [] }],
  ])("parses %s", (raw, expected) => {
    expect(parseChatPublicOutput(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "halo", '{"answer":""}', '{"source_doc_ids":[]}'])("rejects %j", (raw) => {
    expect(parseChatPublicOutput(raw).ok).toBe(false);
  });
});
