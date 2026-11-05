// SEC-09. Pure so it can run in the Edge middleware and be unit-tested.

export interface CspInput {
  nonce: string;
  /** Extra script-src sources. Dev-only values must be chosen at the call site via a literal
   *  process.env.NODE_ENV check, so production bundles drop them entirely. */
  extraScriptSrc?: readonly string[];
  supabaseUrl?: string;
}

export function buildCsp({ nonce, extraScriptSrc = [], supabaseUrl }: CspInput): string {
  const connect = ["'self'", "https://*.supabase.co"];
  if (supabaseUrl) {
    const origin = new URL(supabaseUrl).origin;
    if (!connect.includes(origin)) connect.push(origin);
  }
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...extraScriptSrc];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
};

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
