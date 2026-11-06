// ARCHITECTURE §5.3 steps 5–6 with a mocked Gemini: refining → needs_review / refine_failed, retry,
// stale detection, and redaction of everything that reaches the model or the stored AI version.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createAiClient } from "@/lib/ai/client";
import { mockTransport } from "@/lib/ai/mock-transport";
import { handleRefineRetry, handleStatus, handleUpload } from "@/lib/api/documents";
import { failIfStale, refineDocument, STALE_REFINING_MS } from "@/lib/documents/pipeline";
import type { TransportRequest } from "@/lib/ai/types";
import { captureLogger } from "../helpers/capture-logger";
import { dbAvailable, getDocument, requestId, service } from "../helpers/db";
import { ORIGIN, setupActors, uploadDeps, uploadRequest, type Actors } from "../helpers/phase2";

function client(over?: (req: TransportRequest) => Promise<{ text: string }> | null) {
  const seen: TransportRequest[] = [];
  const base = mockTransport();
  const ai = createAiClient({
    transport: {
      generate: async (req) => {
        seen.push(req);
        const forced = over?.(req);
        return forced ? forced : base.generate(req);
      },
    },
    models: { chat: "c", refine: "r" },
    write: async () => {},
    sleep: async () => {},
    timeoutMs: 1_000,
  });
  return { ai, seen };
}

describe.skipIf(!dbAvailable)("document pipeline (mock Gemini)", () => {
  let a: Actors;
  beforeAll(async () => {
    a = await setupActors("pl");
  });

  async function upload(text: string) {
    const res = await handleUpload(
      uploadRequest({
        committeeId: a.A.id,
        title: "Panduan",
        file: {
          name: "p.md",
          type: "text/markdown",
          bytes: new TextEncoder().encode(`${text}\n<!-- ${randomUUID()} -->`),
        },
      }),
      uploadDeps(a.admin.client),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { documentId: string }).documentId;
  }

  const run = (id: string, ai: ReturnType<typeof client>["ai"]) =>
    refineDocument(id, {
      svc: service(),
      log: captureLogger().log,
      requestId: requestId(),
      generate: (i) => ai.generate(i),
    });

  it("sukses → versi ai_refined (teredaksi) dan status needs_review", async () => {
    const id = await upload("# Lokasi\nGedung C lantai 2, jam 08.00. Kontak panitia@contoh.test");
    const { ai, seen } = client();
    expect(await run(id, ai)).toBe("needs_review");
    // Nothing unredacted reached the model (rule 2); the document is wrapped in delimiters.
    expect(seen[0]?.prompt).toMatch(/^<source_document title="Panduan">/);
    expect(seen[0]?.prompt).not.toContain("panitia@contoh.test");
    const doc = await getDocument(id);
    expect(doc).toMatchObject({ status: "needs_review", version: 3, visibility: "internal" });
    const { data } = await service()
      .from("document_versions")
      .select("kind, content, pii_summary")
      .eq("document_id", id)
      .eq("kind", "ai_refined")
      .single();
    expect(data!.content).toContain("## Lokasi");
    expect(data!.content).toContain("[EMAIL]");
    expect(data!.pii_summary).toEqual({});
  });

  it("keluaran AI yang membocorkan PII palsu tetap disensor sebelum disimpan", async () => {
    const id = await upload("# Info\nTeks biasa");
    const leak = JSON.stringify({
      title: "Info",
      summary: "",
      sections: [{ heading: "Kontak", body: "Hubungi 0812-0000-7777" }],
      faq: [],
    });
    const { ai } = client(async () => ({ text: leak }));
    expect(await run(id, ai)).toBe("needs_review");
    const { data } = await service()
      .from("document_versions")
      .select("content")
      .eq("document_id", id)
      .eq("kind", "ai_refined")
      .single();
    expect(data!.content).toContain("[NOMOR_HP]");
    expect(data!.content).not.toContain("0812-0000-7777");
  });

  it("keluaran tidak valid → refine_failed (ai_invalid_output), lalu retry berhasil", async () => {
    const id = await upload("# Info\n[[mock:invalid]]");
    const { ai } = client();
    expect(await run(id, ai)).toBe("refine_failed");
    expect(await getDocument(id)).toMatchObject({
      status: "refine_failed",
      status_reason: "ai_invalid_output",
    });

    const scheduled: string[] = [];
    const deps = uploadDeps(a.admin.client, scheduled);
    const res = await handleRefineRetry(
      new Request("http://x", { method: "POST", headers: { origin: ORIGIN } }),
      id,
      deps,
    );
    expect(res.status).toBe(202);
    expect(scheduled).toEqual([id]);
    expect((await getDocument(id)).status).toBe("refining");
    const good = client(async () => ({
      text: JSON.stringify({ title: "Info", summary: "", sections: [{ heading: "A", body: "B" }], faq: [] }),
    }));
    expect(await run(id, good.ai)).toBe("needs_review");
  });

  it("Gemini tidak tersedia (500 setelah retry) → refine_failed (ai_unavailable)", async () => {
    const id = await upload("# Info\n[[mock:500]]");
    const { ai, seen } = client();
    expect(await run(id, ai)).toBe("refine_failed");
    expect(seen.length).toBe(2); // one retry, no fallback model configured
    expect((await getDocument(id)).status_reason).toBe("ai_unavailable");
  });

  it("retry ditolak bila status bukan refine_failed", async () => {
    const id = await upload("# Info\nbiasa");
    const res = await handleRefineRetry(
      new Request("http://x", { method: "POST", headers: { origin: ORIGIN } }),
      id,
      uploadDeps(a.admin.client),
    );
    expect(res.status).toBe(400);
  });

  it("refining yang macet > 3 menit ditandai refine_failed (timeout) saat status dipantau", async () => {
    const id = await upload("# Info\nmacet");
    const doc = await getDocument(id);
    expect(
      await failIfStale(
        service(),
        doc as never,
        Date.parse(doc.updated_at as string) + STALE_REFINING_MS + 1,
      ),
    ).toBe(true);
    const res = await handleStatus(id, { ...uploadDeps(a.member.client), svc: service() });
    expect(await res.json()).toMatchObject({ status: "refine_failed", statusReason: "timeout" });
  });
});
