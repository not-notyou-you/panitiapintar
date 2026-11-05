import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("responds ok with a request id", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/health"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });
});
