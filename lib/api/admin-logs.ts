import "server-only";
import { exportCsv, LogReadError, parseLogFilter } from "@/lib/admin/logs";
import { requireRole } from "@/lib/auth/guards";
import { AppError } from "@/lib/http/errors";
import { respond, routeGuard, type RouteDeps } from "./respond";

// GET /api/admin/logs/export (LOGGING §8 "Ekspor CSV"). Super admin only; same filters as the page.
export function handleLogExport(params: URLSearchParams, deps: RouteDeps): Promise<Response> {
  return respond(deps, async () => {
    const { client } = await requireRole("super_admin", routeGuard(deps, "GET /api/admin/logs/export"));
    const filter = parseLogFilter(Object.fromEntries(params));
    let csv: string;
    try {
      csv = await exportCsv(client, filter);
    } catch (err) {
      if (err instanceof LogReadError) throw new AppError("SERVICE_UNAVAILABLE");
      throw err;
    }
    const day = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv}`, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="panitiapintar-${filter.tab}-${day}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  });
}
