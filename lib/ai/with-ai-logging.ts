import "server-only";
import type { Logger } from "pino";
import { serviceClient } from "@/lib/supabase/service";
import type { AiPurpose, AiStatus } from "./types";

export interface AiCallMeta {
  requestId: string;
  purpose: AiPurpose;
  model: string;
  attempt: number;
  fallbackUsed: boolean;
  committeeId?: string | null;
  contextDocIds: string[];
  /** sha256 of system + prompt, for correlation only. The prompt itself is never stored. */
  promptSha256: string;
  contextChars: number;
}

export interface AiCallOutcome {
  status: AiStatus;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
  blockReason?: string;
  timeoutMs?: number;
  /** zod issue paths only, never values (LOGGING §5 ai.output.invalid). */
  validationErrors?: string[];
}

export interface AiCallRow {
  request_id: string;
  purpose: AiPurpose;
  committee_id: string | null;
  model: string;
  fallback_used: boolean;
  attempt: number;
  status: AiStatus;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  prompt_sha256: string;
  context_doc_ids: string[];
  error_code: string | null;
}

export type AiCallWriter = (row: AiCallRow) => Promise<void>;

/** Writes ai_calls with the service role (system task: metadata only, no RLS insert policy exists). */
export const writeAiCallRow: AiCallWriter = async (row) => {
  const { error } = await serviceClient().from("ai_calls").insert(row);
  if (error) throw new Error(`ai_calls insert failed: ${error.code}`);
};

/**
 * Runs one provider attempt: emits ai.call.* events and writes one ai_calls row.
 * A failed ai_calls write is logged but never fails the call itself.
 */
export async function withAiLogging<T extends AiCallOutcome>(
  meta: AiCallMeta,
  deps: { log: Logger; write?: AiCallWriter },
  fn: () => Promise<T>,
): Promise<T> {
  const { log } = deps;
  const base = { purpose: meta.purpose, model: meta.model };
  log.debug(
    { event: "ai.call.started", ...base, attempt: meta.attempt, contextChars: meta.contextChars },
    "ai call started",
  );
  const started = performance.now();
  const outcome = await fn();
  const latencyMs = Math.round(performance.now() - started);

  switch (outcome.status) {
    case "ok":
      log.info(
        {
          event: "ai.call.succeeded",
          ...base,
          latencyMs,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
        },
        "ai call succeeded",
      );
      break;
    case "timeout":
      log.error({ event: "ai.call.timeout", ...base, timeoutMs: outcome.timeoutMs }, "ai call timed out");
      break;
    case "rate_limited":
      log.warn({ event: "ai.call.rate_limited", model: meta.model }, "ai rate limited");
      break;
    case "blocked":
      log.warn({ event: "ai.call.blocked", ...base, blockReason: outcome.blockReason }, "ai call blocked");
      break;
    case "invalid_output":
      log.error(
        {
          event: "ai.output.invalid",
          purpose: meta.purpose,
          validationErrors: outcome.validationErrors ?? [],
        },
        "ai output invalid",
      );
      break;
    case "error":
      log.error({ event: "ai.call.failed", ...base, error: { code: outcome.errorCode } }, "ai call failed");
      break;
  }

  try {
    await (deps.write ?? writeAiCallRow)({
      request_id: meta.requestId,
      purpose: meta.purpose,
      committee_id: meta.committeeId ?? null,
      model: meta.model,
      fallback_used: meta.fallbackUsed,
      attempt: meta.attempt,
      status: outcome.status,
      latency_ms: latencyMs,
      input_tokens: outcome.inputTokens ?? null,
      output_tokens: outcome.outputTokens ?? null,
      prompt_sha256: meta.promptSha256,
      context_doc_ids: meta.contextDocIds,
      error_code: outcome.errorCode ?? null,
    });
  } catch {
    log.error({ event: "ai.calls.write_failed", purpose: meta.purpose }, "ai_calls write failed");
  }
  return outcome;
}
