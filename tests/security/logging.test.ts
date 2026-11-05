// SEC-12: logger-level guarantees, then whole flows (internal chat, generators, upload + refine) with
// fake PII: no PII value, email, raw IP, or document content may appear in any emitted log line.
import { beforeAll, describe, expect, it } from "vitest";
import { createAiClient } from "@/lib/ai/client";
import { mockTransport } from "@/lib/ai/mock-transport";
import { handleUpload } from "@/lib/api/documents";
import { handleGenerate, handleInternalChat } from "@/lib/api/panitia";
import { refineDocument } from "@/lib/documents/pipeline";
import { captureLogger } from "../helpers/capture-logger";
import { createDocument, dbAvailable, service } from "../helpers/db";
import {
  jsonRequest,
  panitiaDeps,
  setupActors,
  uploadDeps,
  uploadRequest,
  type Actors,
} from "../helpers/phase2";

const FAKE = {
  phone: "0812-0000-4321",
  phoneIntl: "+62 813-0000-9876",
  email: "panitia.rahasia@contoh.test",
  nik: "3201000000000009",
  nim: "00000099777",
  account: "1230 0000 0999",
  ip: "203.0.113.45",
  token: "eyJhbGciOiJIUzI1NiJ9.fake.token",
  apiKey: "AIzaFAKEFAKEFAKEFAKE",
  doc: "ANGGARAN INTERNAL: konsumsi Rp4.000.000 CANARY-INT-0001",
};
const NEEDLES = [
  "0812-0000-4321",
  "081200004321",
  "813-0000-9876",
  FAKE.email,
  FAKE.nik,
  FAKE.nim,
  "1230 0000 0999",
  FAKE.ip,
  FAKE.token,
  FAKE.apiKey,
  "CANARY-INT-0001",
];

function expectClean(output: string) {
  for (const needle of NEEDLES) expect(output, `leaked ${needle}`).not.toContain(needle);
}

describe("logger never emits PII, secrets, or document content", () => {
  it("redacts PII in the msg argument", () => {
    const { log, output } = captureLogger();
    log.info(`pertanyaan dari ${FAKE.email} nomor ${FAKE.phone} NIK ${FAKE.nik}`);
    expectClean(output());
    expect(output()).toContain("[EMAIL]");
  });

  it("censors sensitive keys at top level and one level deep", () => {
    const { log, json } = captureLogger();
    log.info({
      event: "test.keys",
      email: FAKE.email,
      ip: FAKE.ip,
      token: FAKE.token,
      content: FAKE.doc,
      prompt: FAKE.doc,
      answer: FAKE.doc,
      message: FAKE.doc,
      actor: { email: FAKE.email, ip: FAKE.ip, apiKey: FAKE.apiKey, password: "hunter2" },
    });
    const [line] = json();
    expect(line.email).toBe("[REDACTED]");
    expect(line.actor.apiKey).toBe("[REDACTED]");
    expect(JSON.stringify(line)).not.toContain("hunter2");
    expectClean(JSON.stringify(line));
  });

  it("strips auth headers and cookies", () => {
    const { log, output } = captureLogger();
    log.info({ req: { headers: { authorization: `Bearer ${FAKE.token}`, cookie: `sb=${FAKE.token}` } } });
    log.info({ headers: { authorization: `Bearer ${FAKE.token}` } });
    expectClean(output());
  });

  it("redacts PII inside free-text fields at any depth", () => {
    const { log, output } = captureLogger();
    log.warn({
      event: "test.deep",
      reason: `gagal kirim ke ${FAKE.phoneIntl}`,
      a: { b: { c: { d: [`nim ${FAKE.nim}`, { note: `rek ${FAKE.account}` }] } } },
    });
    expectClean(output());
  });

  it("redacts PII in error messages and stacks", () => {
    const { log, output } = captureLogger();
    log.error({ event: "test.err", err: new Error(`user ${FAKE.email} HP ${FAKE.phone}`) }, "failed");
    expectClean(output());
  });

  it("emits the required fields", () => {
    const { log, json } = captureLogger();
    log.child({ requestId: "req_01JD3Q8Z7K2M0000000000000A" }).info({ event: "x.y.z" }, "ok");
    const [line] = json();
    expect(line).toMatchObject({ level: "info", env: "test", event: "x.y.z", requestId: expect.any(String) });
    expect(new Date(line.time).toISOString()).toBe(line.time);
  });

  it("respects the level threshold", () => {
    const { log, lines } = captureLogger("info");
    log.debug({ event: "hidden" });
    expect(lines).toHaveLength(0);
  });
});

// Document text that must never be logged, plus PII that must never be logged unredacted.
const DOC_SECRET = "Konsumsi panitia dianggarkan Rp4.750.000 dari dana sponsor utama";

describe.skipIf(!dbAvailable)("flows log no PII, emails, raw IPs, or document content", () => {
  let a: Actors;
  beforeAll(async () => {
    a = await setupActors("lg");
    await createDocument({
      committeeId: a.A.id,
      title: "Anggaran konsumsi",
      visibility: "internal",
      status: "approved",
      content: `${DOC_SECRET}. Kontak bendahara ${FAKE.phone}, ${FAKE.email}. CANARY-INT-0001`,
    });
  });

  function expectFlowClean(lines: string[]) {
    const out = lines.join("\n");
    expectClean(out);
    expect(out).not.toContain(DOC_SECRET);
    expect(out).not.toContain("Rp4.750.000");
    expect(out).not.toContain("@contoh.test");
    for (const l of lines) JSON.parse(l); // one JSON object per line
  }

  it("internal chat", async () => {
    const deps = panitiaDeps(a.member.client);
    const res = await handleInternalChat(
      jsonRequest({
        committeeId: a.A.id,
        message: `Berapa anggaran konsumsi? Saya ${FAKE.email}, HP ${FAKE.phone}, NIK ${FAKE.nik}, IP ${FAKE.ip}`,
        history: [{ role: "user", text: `rekening ${FAKE.account} NIM ${FAKE.nim}` }],
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(deps.lines.some((l) => l.includes('"event":"chat.internal.answered"'))).toBe(true);
    expect(deps.lines.some((l) => l.includes('"event":"chat.pii.redacted"'))).toBe(true);
    expectFlowClean(deps.lines);
  });

  it.each(["rundown", "checklist"] as const)("generator %s", async (kind) => {
    const deps = panitiaDeps(a.member.client);
    const notes = `PIC ${FAKE.email} ${FAKE.phoneIntl} ${FAKE.ip}`;
    const body =
      kind === "rundown"
        ? {
            committeeId: a.A.id,
            eventDate: "2026-11-14",
            start: "09:00",
            end: "12:00",
            activities: `Seminar ${FAKE.phone}`,
            notes,
          }
        : { committeeId: a.A.id, eventDate: "2026-11-14", divisions: ["Acara"], notes };
    const res = await handleGenerate(kind, jsonRequest(body), deps);
    expect(res.status).toBe(200);
    expect(deps.lines.some((l) => l.includes(`"event":"generate.${kind}.completed"`))).toBe(true);
    expectFlowClean(deps.lines);
  });

  it("upload + refine (file name and text with PII)", async () => {
    const scheduled: string[] = [];
    const deps = uploadDeps(a.admin.client, scheduled);
    const text = `# Anggaran

${DOC_SECRET}.

Bendahara: ${FAKE.email}, ${FAKE.phone}, NIK ${FAKE.nik}.`;
    const res = await handleUpload(
      uploadRequest({
        committeeId: a.A.id,
        file: {
          name: `anggaran ${FAKE.phone} ${FAKE.email}.md`,
          type: "text/markdown",
          bytes: new TextEncoder().encode(text),
        },
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect(scheduled).toHaveLength(1);
    const ai = createAiClient({
      transport: mockTransport(),
      models: { chat: "mock", refine: "mock" },
      sleep: async () => {},
    });
    await refineDocument(scheduled[0]!, {
      svc: service(),
      log: deps.log,
      requestId: deps.requestId,
      generate: (i) => ai.generate(i),
    });
    expect(deps.lines.some((l) => l.includes('"event":"document.upload.received"'))).toBe(true);
    expect(deps.lines.some((l) => l.includes('"event":"document.refine.completed"'))).toBe(true);
    expectFlowClean(deps.lines);
  });
});
