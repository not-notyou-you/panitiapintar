import "server-only";
import { redirect } from "next/navigation";
import { requireMembership, requireRole, requireUser, type GuardDeps } from "@/lib/auth/guards";
import { AppError } from "@/lib/http/errors";
import { currentRequestId } from "@/lib/http/request-id.server";
import { audit } from "@/lib/log/audit";
import { withRequest } from "@/lib/log/logger";
import { newRequestId } from "@/lib/log/request-id";
import { serverClient } from "@/lib/supabase/server";

// Same guards as routes/actions, for Server Components. Middleware already redirected sessionless
// visitors; this re-checks (the cookie may be expired or forged) and resolves the role.

export type PageAccess<T> = { ok: true; value: T; requestId: string } | { ok: false; requestId: string };

async function deps(route: string): Promise<GuardDeps> {
  const requestId = (await currentRequestId()) ?? newRequestId();
  const log = withRequest(requestId, { route });
  return { client: await serverClient(), log, route, requestId, audit: (e) => audit(e, { log }) };
}

async function guard<T>(route: string, fn: (g: GuardDeps) => Promise<T>): Promise<PageAccess<T>> {
  const g = await deps(route);
  try {
    return { ok: true, value: await fn(g), requestId: g.requestId };
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED")
      redirect(`/login?next=${encodeURIComponent(route)}`);
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ok: false, requestId: g.requestId };
    throw err;
  }
}

export const pageUser = (route: string) => guard(route, (g) => requireUser(g));
export const pageSuperAdmin = (route: string) => guard(route, (g) => requireRole("super_admin", g));
export const pageMembership = (route: string, committeeId: string, role?: "admin") =>
  guard(route, (g) => requireMembership(committeeId, role, g));
/** Mode Panitia: real members only, super admins included only when they are members themselves. */
export const pageWorkspace = (route: string, committeeId: string) =>
  guard(route, (g) => requireMembership(committeeId, undefined, g, { realMemberOnly: true }));
