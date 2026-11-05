// SEC-12, initial version: logger-level guarantees. The full chat-flow capture lands in Fase 4.
import { describe, expect, it } from "vitest";
import { captureLogger } from "../helpers/capture-logger";

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
