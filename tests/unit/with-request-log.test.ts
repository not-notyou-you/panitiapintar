import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { withRequestLog } from "@/lib/log/with-request-log";
import { captureLogger } from "../helpers/capture-logger";

const req = (headers?: Record<string, string>) => new NextRequest("http://localhost:3000/api/x", { headers });

describe("withRequestLog()", () => {
  it("logs completion with requestId and duration, and echoes x-request-id", async () => {
    const { log, json } = captureLogger();
    const id = "req_01JD3Q8Z7K2M0000000000000A";
    const handler = withRequestLog("GET /api/x", () => NextResponse.json({ ok: true }), log);
    const res = await handler(req({ "x-request-id": id }), {});
    expect(res.headers.get("x-request-id")).toBe(id);
    expect(json()[0]).toMatchObject({
      event: "http.request.completed",
      requestId: id,
      route: "GET /api/x",
      method: "GET",
      status: 200,
      durationMs: expect.any(Number),
    });
  });

  it("returns a generic 500 with requestId and never leaks the error to the client", async () => {
    const { log, json, output } = captureLogger();
    const handler = withRequestLog(
      "GET /api/x",
      () => {
        throw new Error("db password=hunter2 for a@contoh.test");
      },
      log,
    );
    const res = await handler(req(), {});
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "internal_error", requestId: res.headers.get("x-request-id") });
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(json()[0]).toMatchObject({ event: "http.request.failed", level: "error" });
    expect(output()).not.toContain("a@contoh.test");
  });
});
