// ROADMAP 1.6: the committed seed.sql must match its generator, and canaries must hold their guarantees.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSeed } from "@/scripts/build-seed";

const committed = readFileSync(path.resolve(__dirname, "../../supabase/seed.sql"), "utf8");

describe("seed", () => {
  it("supabase/seed.sql is up to date (run npm run seed:build)", () => {
    expect(committed.replace(/\r\n/g, "\n")).toBe(buildSeed());
  });

  it("has six unique canaries, all in internal documents", () => {
    const codes = committed.match(/CANARY-INT-[A-Z0-9]{4}/g) ?? [];
    expect(new Set(codes).size).toBe(6);
  });

  it("uses only @contoh.test accounts", () => {
    const emails = committed.match(/'[^' ]+@[^' ]+'/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) expect(e).toMatch(/@contoh\.test'$/);
  });
});
