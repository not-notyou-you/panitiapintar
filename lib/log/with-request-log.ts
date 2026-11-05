import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { Logger } from "pino";
import { logger as rootLogger } from "./logger";
import { REQUEST_ID_HEADER, isValidRequestId, newRequestId } from "./request-id";

type Handler<C> = (
  req: NextRequest,
  log: Logger,
  ctx: C,
  requestId: string,
) => Promise<Response> | Response;

/**
 * Wraps a route handler: binds requestId to the logger, records http.request.completed/failed,
 * and turns uncaught errors into a generic 500 carrying only the requestId (CLAUDE.md rule 8).
 */
export function withRequestLog<C = unknown>(route: string, handler: Handler<C>, base: Logger = rootLogger) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const incoming = req.headers.get(REQUEST_ID_HEADER);
    const requestId = isValidRequestId(incoming) ? incoming : newRequestId();
    const log = base.child({ requestId, route });
    const started = performance.now();
    let res: Response;
    try {
      res = await handler(req, log, ctx, requestId);
      log.info(
        {
          event: "http.request.completed",
          method: req.method,
          status: res.status,
          durationMs: elapsed(started),
        },
        "request completed",
      );
    } catch (err) {
      const code = err instanceof Error ? err.name : "unknown";
      log.error({ event: "http.request.failed", status: 500, error: { code }, err }, "request failed");
      res = NextResponse.json(
        { error: { code: "INTERNAL", message: "Terjadi kesalahan. Coba lagi nanti.", requestId } },
        { status: 500 },
      );
    }
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
