// SEC-05. All values below are fake (0000/0812-0000 ranges, @contoh.test).
import { describe, expect, it } from "vitest";
import { redact, redactDeep, scanPii, type PiiType } from "@/lib/privacy";

const FW = (s: string) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)));
const ZW = "​";

type Case = [name: string, input: string, expected: string, types: Partial<Record<PiiType, number>>];

const positive: Case[] = [
  // Phone
  ["hp 0812 compact", "Hubungi 081200001234", "Hubungi [NOMOR_HP]", { phone: 1 }],
  ["hp dashed", "HP 0812-0000-1234", "HP [NOMOR_HP]", { phone: 1 }],
  ["hp spaced", "WA 0812 0000 1234 ya", "WA [NOMOR_HP] ya", { phone: 1 }],
  ["hp dotted", "0812.0000.1234", "[NOMOR_HP]", { phone: 1 }],
  ["hp +62 spaced", "+62 812-0000-1234", "[NOMOR_HP]", { phone: 1 }],
  ["hp +62 compact", "+6281200001234", "[NOMOR_HP]", { phone: 1 }],
  ["hp 62 prefix", "62812000012345", "[NOMOR_HP]", { phone: 1 }],
  ["hp short 10 digit", "0857000012", "[NOMOR_HP]", { phone: 1 }],
  ["hp glued to label", "HP:081300001234.", "HP:[NOMOR_HP].", { phone: 1 }],
  ["hp in parentheses", "(0812-0000-1234)", "([NOMOR_HP])", { phone: 1 }],
  ["hp two numbers", "0812-0000-1111 / 0813-0000-2222", "[NOMOR_HP] / [NOMOR_HP]", { phone: 2 }],
  ["hp full-width", FW("081200001234"), "[NOMOR_HP]", { phone: 1 }],
  ["hp zero-width split", `0812${ZW}0000${ZW}1234`, "[NOMOR_HP]", { phone: 1 }],
  ["hp unicode dash", "0812–0000–1234", "[NOMOR_HP]", { phone: 1 }],
  // NIK
  ["nik", "NIK 3201000000000001", "NIK [NIK]", { nik: 1 }],
  ["nik full-width", FW("3201000000000002"), "[NIK]", { nik: 1 }],
  ["nik zero-width", `32010000${ZW}00000003`, "[NIK]", { nik: 1 }],
  // NIM
  ["nim", "NIM 00000099123", "NIM [NIM]", { nim: 1 }],
  ["nim glued", "NIM:00000099124,", "NIM:[NIM],", { nim: 1 }],
  ["nim full-width", FW("00000099125"), "[NIM]", { nim: 1 }],
  // Email
  ["email", "kirim ke panitia.satu@contoh.test", "kirim ke [EMAIL]", { email: 1 }],
  ["email plus tag", "a.b+lomba@contoh.test.", "[EMAIL].", { email: 1 }],
  ["email subdomain", "x_y@mail.kampus.contoh.test", "[EMAIL]", { email: 1 }],
  ["email numeric local part", "081200001234@contoh.test", "[EMAIL]", { email: 1 }],
  ["email nim local part", "00000099126@student.contoh.test", "[EMAIL]", { email: 1 }],
  ["email full-width at", "budi＠contoh.test", "[EMAIL]", { email: 1 }],
  // Account / card
  ["rekening 10 digit", "Rek BCA 1230000001", "Rek BCA [NOMOR_REKENING]", { account: 1 }],
  ["rekening spaced", "1230 0000 0145", "[NOMOR_REKENING]", { account: 1 }],
  ["rekening dashed", "123-000-000-1456", "[NOMOR_REKENING]", { account: 1 }],
  ["card 16 spaced", "4111 0000 0000 0000", "[NOMOR_REKENING]", { account: 1 }],
  ["rekening 19 digit", "1234000000000000019", "[NOMOR_REKENING]", { account: 1 }],
  // NPWP
  ["npwp", "NPWP 01.234.567.8-901.000", "NPWP [NPWP]", { npwp: 1 }],
  ["npwp full-width", FW("01.234.567.8-901.001"), "[NPWP]", { npwp: 1 }],
  // Mixed
  [
    "mixed sentence",
    "Saya Budi, NIM 00000099127, HP 0812-0000-5678, email budi@contoh.test",
    "Saya Budi, NIM [NIM], HP [NOMOR_HP], email [EMAIL]",
    { nim: 1, phone: 1, email: 1 },
  ],
];

const negative: Array<[name: string, input: string]> = [
  ["date slash", "Acara 05/11/2026 di aula"],
  ["date iso", "Tanggal 2026-11-05"],
  ["date long", "Sabtu, 21 November 2026"],
  ["time colon", "Mulai pukul 09:30 WIB"],
  ["time dot range", "Registrasi 08.00-10.00"],
  ["price Rp150.000", "Tiket Rp150.000"],
  ["price spaced", "HTM Rp 1.250.000,00"],
  ["price big", "Anggaran Rp1.500.000.000"],
  ["year range", "Periode 2025-2026"],
  ["postal code", "Tangerang 15810"],
  ["quota", "Kuota 500 peserta, 25 tim"],
  ["short code", "Kode tiket A-0812"],
  ["nine digits", "Nomor antrean 123456789"],
  ["redacted label stays", "Hubungi [NOMOR_HP] atau [EMAIL]"],
  ["no at sign", "panitia di contoh.test"],
];

describe("redact(): positive cases", () => {
  it.each(positive)("%s", (_name, input, expected, types) => {
    const r = redact(input);
    expect(r.text).toBe(expected);
    expect(r.found).toEqual(types);
  });
});

describe("redact(): negative cases (must stay untouched)", () => {
  it.each(negative)("%s", (_name, input) => {
    const r = redact(input);
    expect(r.text).toBe(input.normalize("NFKC"));
    expect(r.found).toEqual({});
  });
});

describe("redact(): result shape", () => {
  it("never returns the original value anywhere in the result", () => {
    const secret = "081200009999";
    const r = redact(`nomor saya ${secret}`);
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it("is idempotent", () => {
    const once = redact("HP 0812-0000-1234, NIK 3201000000000001").text;
    expect(redact(once)).toEqual({ text: once, found: {} });
  });
});

describe("scanPii()", () => {
  it("returns counts only", () => {
    const r = scanPii("0812-0000-1234 dan 0813-0000-1234, a@contoh.test");
    expect(r).toEqual({ found: { phone: 2, email: 1 }, total: 3 });
    expect(JSON.stringify(r)).not.toMatch(/0812|contoh/);
  });
  it("is zero on clean text", () => {
    expect(scanPii("Acara mulai 09:30, tiket Rp150.000").total).toBe(0);
  });
});

describe("redactDeep()", () => {
  it("redacts nested strings and counts them", () => {
    const found = {};
    const out = redactDeep({ a: ["0812-0000-1234"], b: { c: "x@contoh.test", n: 5, ok: true } }, found);
    expect(out).toEqual({ a: ["[NOMOR_HP]"], b: { c: "[EMAIL]", n: 5, ok: true } });
    expect(found).toEqual({ phone: 1, email: 1 });
  });
  it("survives cycles", () => {
    const o: Record<string, unknown> = { v: "a@contoh.test" };
    o.self = o;
    expect(redactDeep(o)).toEqual({ v: "[EMAIL]", self: "[TRUNCATED]" });
  });
  it("redacts Error message and stack", () => {
    const out = redactDeep({ err: new Error("gagal untuk a@contoh.test") });
    expect(JSON.stringify(out)).not.toContain("a@contoh.test");
  });
});

describe("redact performance (DoS guard)", () => {
  it.each([
    ["word chars", "a".repeat(200_000)],
    ["dots and plus", "a.b+".repeat(50_000)],
    ["digits", "1".repeat(200_000)],
    ["at-signs", "a@".repeat(100_000)],
  ])("is linear on a 200k run of %s", (_label, input) => {
    const started = performance.now();
    redact(input);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("still redacts an address whose local part exceeds 64 chars", () => {
    expect(redact(`${"x".repeat(80)}@contoh.test`).text).not.toContain("@contoh.test");
  });
});

describe("UUIDs are ids, not PII", () => {
  it.each([
    "00000000-0000-4000-a000-0000000000c1",
    "12345678-1234-4123-8123-123456789012",
    "e3b0c442-98fc-4c14-9afb-f4c8996fb924",
  ])("keeps %s intact", (id) => {
    expect(redact(`committee ${id}`)).toEqual({ text: `committee ${id}`, found: {} });
  });

  it("still redacts PII next to a UUID", () => {
    const r = redact("id 12345678-1234-4123-8123-123456789012 hp 081200009999");
    expect(r.text).toBe("id 12345678-1234-4123-8123-123456789012 hp [NOMOR_HP]");
    expect(r.found).toEqual({ phone: 1 });
  });

  it("still redacts a hyphenated account number that is not UUID-shaped", () => {
    expect(redact("rek 12345678-1234-5678").text).toBe("rek [NOMOR_REKENING]");
  });

  it("ignores spoofed private-use markers", () => {
    expect(redact("0 0812-0000-1234").text).toBe("0 [NOMOR_HP]");
  });
});
