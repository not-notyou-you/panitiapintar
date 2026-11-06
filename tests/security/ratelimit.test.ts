// SEC-07: the 11th public chat request within a minute from one IP gets 429 + Retry-After.
// Runs against local Supabase (real rate_limit_hit RPC) and the real route with AI_MOCK=true.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { createCommittee, createDocument, dbAvailable, service } from "../helpers/db";

process.env.AI_MOCK = "true";

describe.skipIf(!dbAvailable)("rate limit (DB)", () => {
  it("allows 10 hits per minute and refuses the 11th with a Retry-After inside the window", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `test-${randomUUID()}`;
    for (let i = 1; i <= 10; i++) expect(await rateLimit("chat_public", key)).toEqual({ ok: true });
    const res = await rateLimit("chat_public", key);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res).toMatchObject({ limit: 10, window: "min" });
      expect(res.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(res.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("keys are independent", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const a = `test-${randomUUID()}`;
    for (let i = 0; i < 11; i++) await rateLimit("chat_public", a);
    expect(await rateLimit("chat_public", `test-${randomUUID()}`)).toEqual({ ok: true });
  });
});

describe.skipIf(!dbAvailable)("POST /api/chat/public (route + DB + mock AI)", () => {
  let slug: string;
  let docId: string;

  beforeAll(async () => {
    const c = await createCommittee("rl");
    slug = c.slug;
    docId = (
      await createDocument({
        committeeId: c.id,
        title: "Guidebook",
        visibility: "public",
        status: "approved",
        content: "Lokasi acara: Aula Utama Gedung C lantai 1.",
      })
    ).id;
    await createDocument({
      committeeId: c.id,
      title: "Anggaran",
      visibility: "internal",
      status: "approved",
      content: "Lokasi rapat anggaran CANARY-INT-RL01",
    });
  });

  async function post(ip: string, message = "Di mana lokasi acara?") {
    const { POST } = await import("@/app/api/chat/public/route");
    const req = new NextRequest("http://localhost:3000/api/chat/public", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip },
      body: JSON.stringify({ slug, message }),
    });
    return POST(req, undefined);
  }

  it("answers from public docs only, with one requestId across header, ai_calls and chat_logs", async () => {
    const res = await post(`10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      answer: string;
      answered: boolean;
      sources: { documentId: string }[];
      requestId: string;
    };
    expect(body.answered).toBe(true);
    expect(body.sources.map((s) => s.documentId)).toEqual([docId]);
    expect(body.answer).not.toContain("CANARY");
    expect(res.headers.get("x-request-id")).toBe(body.requestId);

    const svc = service();
    const ai = await svc
      .from("ai_calls")
      .select("request_id, status, purpose")
      .eq("request_id", body.requestId);
    const chat = await svc.from("chat_logs").select("request_id, answered").eq("request_id", body.requestId);
    expect(ai.data).toEqual([{ request_id: body.requestId, status: "ok", purpose: "chat_public" }]);
    expect(chat.data).toEqual([{ request_id: body.requestId, answered: true }]);
  });

  it("returns 429 with Retry-After on the 11th request in a minute from one IP", async () => {
    const ip = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 1; i <= 10; i++) expect((await post(ip)).status).toBe(200);
    const res = await post(ip);
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(body.error).toMatchObject({
      code: "RATE_LIMITED",
      message: "Chatbot sedang ramai. Coba lagi dalam 1 menit.",
    });
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("rejects a foreign Origin with 403", async () => {
    const { POST } = await import("@/app/api/chat/public/route");
    const res = await POST(
      new NextRequest("http://localhost:3000/api/chat/public", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://jahat.contoh.test" },
        body: JSON.stringify({ slug, message: "x" }),
      }),
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a body over 16 KB with 413", async () => {
    const res = await post("10.3.0.1", "a".repeat(17 * 1024));
    expect(res.status).toBe(413);
  });
});
