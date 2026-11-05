import "server-only";
import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { env } from "@/lib/env";
import { geminiTransport } from "./gemini-transport";
import { mockTransport } from "./mock-transport";
import {
  AiTransportError,
  type AiPurpose,
  type AiStatus,
  type AiTransport,
  type ParseResult,
  type TransportResponse,
} from "./types";
import { withAiLogging, type AiCallOutcome, type AiCallWriter } from "./with-ai-logging";

export const AI_TIMEOUT_MS = 20_000;
const BACKOFF_BASE_MS = 400;
const BACKOFF_JITTER_MS = 400;

export type ModelRole = "chat" | "refine";

export interface GenerateInput<T> {
  purpose: AiPurpose;
  role: ModelRole;
  system: string;
  prompt: string;
  /** Validates model output (zod inside). Invalid output is never retried: the same prompt tends to fail again. */
  parse: (text: string) => ParseResult<T>;
  requestId: string;
  committeeId?: string | null;
  contextDocIds?: string[];
  log: Logger;
  /** Per-attempt timeout override (refine handles long documents). */
  timeoutMs?: number;
}

export type GenerateResult<T> =
  | { status: "ok"; value: T; model: string; fallbackUsed: boolean }
  | { status: Exclude<AiStatus, "ok">; model: string; fallbackUsed: boolean };

export interface AiClientDeps {
  transport: AiTransport;
  models: { chat: string; refine: string; fallback?: string };
  timeoutMs?: number;
  write?: AiCallWriter;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface AttemptOutcome<T> extends AiCallOutcome {
  value?: T;
  retryable?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Gemini call with the ARCHITECTURE §6 policy: per-attempt timeout, one retry with backoff + jitter for
 * timeout/5xx/network errors, then the fallback model. 429 is never retried. Every attempt is logged.
 */
export function createAiClient(deps: AiClientDeps) {
  const timeoutMs = deps.timeoutMs ?? AI_TIMEOUT_MS;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  async function attempt<T>(input: GenerateInput<T>, model: string): Promise<AttemptOutcome<T>> {
    const limitMs = input.timeoutMs ?? timeoutMs;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, limitMs);
    });
    try {
      const res = await Promise.race([
        deps.transport.generate({
          model,
          system: input.system,
          prompt: input.prompt,
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (res === "timeout") return { status: "timeout", timeoutMs: limitMs, errorCode: "timeout", retryable: true };
      return classifyResponse(res, input.parse);
    } catch (err) {
      if (controller.signal.aborted) return { status: "timeout", timeoutMs: limitMs, errorCode: "timeout", retryable: true };
      if (err instanceof AiTransportError) {
        if (err.httpStatus === 429) return { status: "rate_limited", errorCode: "http_429" };
        const retryable = err.httpStatus === undefined || err.httpStatus >= 500;
        return { status: "error", errorCode: err.code, retryable };
      }
      return { status: "error", errorCode: err instanceof Error ? err.name : "unknown", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async function generate<T>(input: GenerateInput<T>): Promise<GenerateResult<T>> {
    const primary = input.role === "chat" ? deps.models.chat : deps.models.refine;
    const models = deps.models.fallback && deps.models.fallback !== primary ? [primary, deps.models.fallback] : [primary];
    const promptSha256 = createHash("sha256").update(input.system).update("\0").update(input.prompt).digest("hex");
    let last: GenerateResult<T> = { status: "error", model: primary, fallbackUsed: false };

    for (const [i, model] of models.entries()) {
      const fallbackUsed = i > 0;
      if (fallbackUsed) {
        input.log.warn({ event: "ai.call.fallback", fromModel: models[i - 1], toModel: model }, "ai fallback");
      }
      for (let n = 1; n <= 2; n++) {
        const outcome = await withAiLogging(
          {
            requestId: input.requestId,
            purpose: input.purpose,
            model,
            attempt: n,
            fallbackUsed,
            committeeId: input.committeeId,
            contextDocIds: input.contextDocIds ?? [],
            promptSha256,
            contextChars: input.prompt.length,
          },
          { log: input.log, write: deps.write },
          () => attempt(input, model),
        );
        if (outcome.status === "ok") return { status: "ok", value: outcome.value as T, model, fallbackUsed };
        last = { status: outcome.status, model, fallbackUsed };
        if (!outcome.retryable) return last;
        if (n === 1) {
          input.log.warn({ event: "ai.call.retried", attempt: n + 1, reason: outcome.errorCode }, "ai retry");
          await sleep(BACKOFF_BASE_MS + Math.floor(random() * BACKOFF_JITTER_MS));
        }
      }
    }
    return last;
  }

  return { generate };
}

function classifyResponse<T>(res: TransportResponse, parse: (text: string) => ParseResult<T>): AttemptOutcome<T> {
  const tokens = { inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  if (res.blockReason) return { status: "blocked", blockReason: res.blockReason, errorCode: "blocked", ...tokens };
  const parsed = parse(res.text);
  if (!parsed.ok) {
    return { status: "invalid_output", errorCode: "invalid_output", validationErrors: parsed.paths, ...tokens };
  }
  return { status: "ok", value: parsed.value, ...tokens };
}

let shared: ReturnType<typeof createAiClient> | undefined;

/** App-wide client from env. AI_MOCK swaps in the deterministic fake (never in production, see env-schema). */
export function aiClient() {
  if (shared) return shared;
  const e = env();
  shared = createAiClient({
    transport: e.AI_MOCK ? mockTransport() : geminiTransport(e.GEMINI_API_KEY),
    models: { chat: e.GEMINI_MODEL_CHAT, refine: e.GEMINI_MODEL_REFINE, fallback: e.GEMINI_MODEL_FALLBACK },
  });
  return shared;
}
