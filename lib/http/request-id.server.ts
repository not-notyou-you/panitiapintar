import "server-only";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, isValidRequestId } from "@/lib/log/request-id";

/** requestId that middleware attached to this page request, for ErrorState. */
export async function currentRequestId(): Promise<string | null> {
  const id = (await headers()).get(REQUEST_ID_HEADER);
  return isValidRequestId(id) ? id : null;
}
