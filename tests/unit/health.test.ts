import { describe, expect, it } from "vitest";
import { bearerMatches, handleHealth } from "@/lib/api/system";
import { captureLogger } from "../helpers/capture-logger";

describe("GET /api/health (handleHealth)", () => {
  it("ok when db is up and AI is configured", async () => {
    const { log } = captureLogger();
    const res = await handleHealth({ log, pingDb: async () => true, aiConfigured: true, version: "abc1234" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up", ai: "configured", version: "abc1234" });
  });

  it("degraded + 503 + health.check.degraded when db is down or key missing", async () => {
    const { log, lines } = captureLogger();
    const res = await handleHealth({ log, pingDb: async () => false, aiConfigured: false, version: "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", db: "down", ai: "missing" });
    expect(lines.some((l) => l.includes('"event":"health.check.degraded"'))).toBe(true);
  });

  it("a throwing ping counts as down", async () => {
    const { log } = captureLogger();
    const res = await handleHealth({
      log,
      pingDb: () => Promise.reject(new Error("x")),
      aiConfigured: true,
      version: "x",
    });
    expect((await res.json()).db).toBe("down");
  });
});

describe("bearerMatches (CRON_SECRET)", () => {
  const secret = "s3cret-cron-value-123456";
  it("accepts only the exact bearer token", () => {
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatches(null, secret)).toBe(false);
    expect(bearerMatches(secret, secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(bearerMatches("Bearer ", secret)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });
});
