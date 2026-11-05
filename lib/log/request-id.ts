import { ulid } from "ulid";

const REQUEST_ID = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

export const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return `req_${ulid()}`;
}

/** Only well-formed ids are accepted from outside, so callers cannot inject arbitrary text into logs. */
export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}
