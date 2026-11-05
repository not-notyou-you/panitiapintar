import { describe, expect, it } from "vitest";
import { DbDeniedError, dbError, toErrorBody } from "@/lib/actions/runtime";
import { captureLogger } from "../helpers/capture-logger";

describe("dbError → security.rls.denied", () => {
  it("42501 becomes FORBIDDEN and is logged as security.rls.denied", () => {
    const err = dbError({ code: "42501", message: "permission denied for table documents" }, "documents.update");
    expect(err).toBeInstanceOf(DbDeniedError);
    const { log, json } = captureLogger();
    const body = toErrorBody(err, log, "req_01JD3Q8Z7K2M0000000000000A");
    expect(body.code).toBe("FORBIDDEN");
    expect(json()).toEqual([
      expect.objectContaining({ event: "security.rls.denied", operation: "documents.update", level: "warn" }),
    ]);
  });
  it("other mapped codes do not log rls.denied", () => {
    const { log, lines } = captureLogger();
    toErrorBody(dbError({ code: "40001" }), log, "req_x");
    expect(lines).toHaveLength(0);
  });
});
