import "server-only";
import QRCode from "qrcode";
import { requireMembership, requireUser } from "@/lib/auth/guards";
import { AppError } from "@/lib/http/errors";
import { committeeSlugSchema, qrQuerySchema } from "@/lib/validation/admin";
import { respond, routeGuard, type RouteDeps } from "./respond";

export function publicEventUrl(appUrl: string, slug: string): string {
  return `${new URL(appUrl).origin}/e/${slug}`;
}

// GET /api/qr/[slug]?format=png|svg&size=512|1024 — admin of that committee (API.md §2).
export function handleQr(slug: string, search: URLSearchParams, deps: RouteDeps): Promise<Response> {
  return respond(deps, async () => {
    const g = routeGuard(deps, "GET /api/qr/[slug]");
    const s = committeeSlugSchema.safeParse(slug);
    const q = qrQuerySchema.safeParse({
      format: search.get("format") ?? undefined,
      size: search.get("size") ?? undefined,
    });
    if (!s.success) throw new AppError("NOT_FOUND");
    if (!q.success) throw new AppError("INVALID_INPUT", "Format atau ukuran QR tidak valid.");
    await requireUser(g);
    // RLS: active committees are readable by everyone, archived ones by members only.
    const { data } = await deps.client.from("committees").select("id").eq("slug", s.data).maybeSingle();
    if (!data) throw new AppError("NOT_FOUND");
    await requireMembership(data.id as string, "admin", g);

    const url = publicEventUrl(deps.appUrl, s.data);
    const opts = { width: q.data.size, margin: 2, errorCorrectionLevel: "M" as const };
    const headers = {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="qr-${s.data}.${q.data.format}"`,
    };
    if (q.data.format === "svg") {
      const svg = await QRCode.toString(url, { ...opts, type: "svg" });
      return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml" } });
    }
    const png = await QRCode.toBuffer(url, { ...opts, type: "png" });
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  });
}
