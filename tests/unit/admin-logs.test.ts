import { describe, expect, it } from "vitest";
import { aiStats, exceededWindows, parseLogFilter, toCsv, type AiCallRow } from "@/lib/admin/logs";

describe("toCsv", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ['=HYPERLINK("x")', "+1"],
        ["-2", "@cmd"],
        ['he said "hi", ok', null],
      ],
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",'+1`);
    expect(lines[2]).toBe("'-2,'@cmd");
    expect(lines[3]).toBe('"he said ""hi"", ok",');
  });
});

describe("parseLogFilter", () => {
  it("falls back to defaults on junk instead of throwing", () => {
    const f = parseLogFilter({
      tab: "drop table",
      range: "999",
      committee: "x",
      action: "nope",
      outcome: "x",
      detail: "-1",
    });
    expect(f).toEqual({
      tab: "audit",
      range: "7",
      committee: undefined,
      action: undefined,
      outcome: undefined,
      detail: undefined,
    });
  });
  it("keeps valid values", () => {
    const id = "6f1c1d1e-1b1b-4c4c-8d8d-1e1e1e1e1e1e";
    const f = parseLogFilter({ tab: "ai", range: "30", committee: id, outcome: "denied", detail: "12" });
    expect(f).toMatchObject({ tab: "ai", range: "30", committee: id, outcome: "denied", detail: 12 });
  });
});

describe("aiStats", () => {
  const now = Date.parse("2026-11-20T05:30:00Z"); // 12.30 WIB
  const row = (iso: string, over: Partial<AiCallRow> = {}): AiCallRow => ({
    id: 1,
    occurred_at: iso,
    request_id: "req_x",
    purpose: "chat_public",
    committee_id: null,
    model: "m",
    fallback_used: false,
    attempt: 1,
    status: "ok",
    latency_ms: 100,
    input_tokens: 10,
    output_tokens: 2,
    error_code: null,
    ...over,
  });
  it("computes cards, hourly bars in WIB and token totals", () => {
    const s = aiStats(
      [
        row("2026-11-20T05:10:00Z", { latency_ms: 300 }),
        row("2026-11-20T05:20:00Z", { status: "timeout", fallback_used: true, latency_ms: 100 }),
        row("2026-11-19T10:00:00Z", { latency_ms: 200 }), // 17.00 WIB yesterday
      ],
      now,
    );
    expect(s.callsToday).toBe(2);
    expect(s.avgLatencyMs).toBe(200);
    expect(s.errorRate).toBeCloseTo(1 / 3);
    expect(s.fallbackRate).toBeCloseTo(1 / 3);
    expect(s.hourly).toHaveLength(24);
    expect(s.hourly[23]).toEqual({ hour: "12", calls: 2, errors: 1 });
    expect(s.tokensPerDay[0]).toEqual({ day: "2026-11-20", input: 20, output: 4 });
  });
  it("handles no data", () => {
    const s = aiStats([], now);
    expect(s.avgLatencyMs).toBeNull();
    expect(s.errorRate).toBeNull();
  });
});

describe("exceededWindows", () => {
  it("keeps only windows over the configured max", () => {
    const out = exceededWindows([
      { bucket: "chat_public:min:abcdef0123456789", window_start: "2026-11-20T05:00:00Z", hits: 11 },
      { bucket: "chat_public:min:ffff", window_start: "2026-11-20T05:00:00Z", hits: 10 },
      { bucket: "unknown:min:x", window_start: "2026-11-20T05:00:00Z", hits: 999 },
    ]);
    expect(out).toEqual([
      {
        bucket: "chat_public",
        window: "min",
        key: "abcdef012345",
        windowStart: "2026-11-20T05:00:00Z",
        hits: 11,
        limit: 10,
      },
    ]);
  });
});
