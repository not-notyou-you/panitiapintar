import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, isValidRequestId, newRequestId } from "@/lib/log/request-id";
import { STATIC_SECURITY_HEADERS, buildCsp, newNonce } from "@/lib/security/headers";

const SESSION_TIMEOUT_MS = 3000;
const PROTECTED = /^\/(panitia|admin)(\/|$)/;

export async function middleware(req: NextRequest) {
  const incoming = req.headers.get(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : newRequestId();
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    // React/Next dev tooling needs eval. NODE_ENV (not APP_ENV) because preview builds run as production.
    extraScriptSrc: process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : [],
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // Next reads the CSP from the request to apply the nonce to its own scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let res = NextResponse.next({ request: { headers: requestHeaders } });
  const user = await refreshSession(
    req,
    requestHeaders,
    (r) => (res = r),
    () => res,
  );

  if (PROTECTED.test(req.nextUrl.pathname) && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    const redirect = NextResponse.redirect(url);
    for (const c of res.cookies.getAll()) redirect.cookies.set(c);
    res = redirect;
  }

  res.headers.set(REQUEST_ID_HEADER, requestId);
  res.headers.set("Content-Security-Policy", csp);
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

/** Refreshes the Supabase session cookie and returns the user id, or null. Never throws. */
async function refreshSession(
  req: NextRequest,
  requestHeaders: Headers,
  setRes: (r: NextResponse) => void,
  getRes: () => NextResponse,
): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  if (!req.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return null;
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        requestHeaders.set("cookie", req.cookies.toString());
        const next = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of list) next.cookies.set(name, value, options);
        for (const c of getRes().cookies.getAll()) if (!next.cookies.get(c.name)) next.cookies.set(c);
        setRes(next);
      },
    },
  });
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), SESSION_TIMEOUT_MS);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("session_refresh_timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
