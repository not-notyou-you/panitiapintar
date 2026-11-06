// SEC-09
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const REQ_ID = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

async function run(pathname: string, headers?: Record<string, string>) {
  vi.resetModules();
  const { middleware } = await import("@/middleware");
  return middleware(new NextRequest(new URL(pathname, "http://localhost:3000"), { headers }));
}

afterEach(() => vi.unstubAllEnvs());

describe("middleware security headers", () => {
  it("sets CSP, HSTS, frame, sniffing, referrer and permissions headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await run("/");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("production CSP never allows unsafe-eval", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await run("/")).headers.get("content-security-policy")).not.toContain("unsafe-eval");
  });

  it("APP_ENV=development alone does not enable unsafe-eval (preview builds run as production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "development");
    expect((await run("/")).headers.get("content-security-policy")).not.toContain("unsafe-eval");
  });

  it("dev CSP allows unsafe-eval for Next tooling", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await run("/")).headers.get("content-security-policy")).toContain("'unsafe-eval'");
  });

  it("uses a fresh nonce per request", async () => {
    const a = (await run("/")).headers.get("content-security-policy");
    const b = (await run("/")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("built middleware bundle contains no unsafe-eval", () => {
    const dir = path.resolve(".next/server");
    // Only a production build counts: `next dev` also writes .next/server but always allows eval.
    if (!existsSync(path.resolve(".next/BUILD_ID")) || !existsSync(path.join(dir, "middleware.js"))) return;
    const files = walk(dir).filter((f) => /middleware|edge-chunks/.test(f) && f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toContain("unsafe-eval");
  });
});

describe("middleware request id", () => {
  it("adds a req_ + ULID x-request-id", async () => {
    expect((await run("/")).headers.get("x-request-id")).toMatch(REQ_ID);
  });

  it("keeps a well-formed incoming id", async () => {
    const id = "req_01JD3Q8Z7K2M0000000000000A";
    expect((await run("/", { "x-request-id": id })).headers.get("x-request-id")).toBe(id);
  });

  it("replaces a malformed incoming id", async () => {
    const res = await run("/", { "x-request-id": "req_evil log-injection" });
    expect(res.headers.get("x-request-id")).toMatch(REQ_ID);
  });
});

describe("middleware route protection", () => {
  it.each(["/panitia", "/panitia/abc", "/admin", "/admin/logs"])(
    "redirects %s to /login without a session",
    async (p) => {
      const res = await run(p);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
      expect(res.headers.get("x-request-id")).toMatch(REQ_ID);
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    },
  );

  it.each(["/", "/e/festival-teknologi-fiktif", "/api/health", "/administrasi"])(
    "lets %s through",
    async (p) => {
      expect((await run(p)).status).toBe(200);
    },
  );
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
