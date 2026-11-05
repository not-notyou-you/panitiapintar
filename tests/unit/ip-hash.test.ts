import { describe, expect, it } from "vitest";
import { emailHash, ipHash } from "@/lib/privacy/ip-hash";

const SALT = "x".repeat(32);

describe("ipHash (SEC-12)", () => {
  it("is stable within a month and changes across months", () => {
    const a = ipHash("203.0.113.7", SALT, new Date("2026-11-01T00:00:00Z"));
    expect(ipHash("203.0.113.7", SALT, new Date("2026-11-30T23:59:59Z"))).toBe(a);
    expect(ipHash("203.0.113.7", SALT, new Date("2026-12-01T00:00:00Z"))).not.toBe(a);
  });
  it("never contains the IP and depends on the salt", () => {
    const h = ipHash("203.0.113.7", SALT, new Date("2026-11-05T00:00:00Z"));
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(ipHash("203.0.113.7", "y".repeat(32), new Date("2026-11-05T00:00:00Z"))).not.toBe(h);
  });
  it("emailHash is lowercase/trim insensitive", () => {
    expect(emailHash(" A@Contoh.Test ", SALT)).toBe(emailHash("a@contoh.test", SALT));
  });
});
