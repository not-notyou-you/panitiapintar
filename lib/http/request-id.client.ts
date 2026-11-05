// Client-side read of the requestId the root layout writes into <meta name="request-id">, so error
// boundaries in either area can show the same id the server logged (INTERFACE §4.10).
const REQUEST_ID = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

export function requestIdFromDocument(): string | null {
  if (typeof document === "undefined") return null;
  const v = document.querySelector('meta[name="request-id"]')?.getAttribute("content") ?? "";
  return REQUEST_ID.test(v) ? v : null;
}
