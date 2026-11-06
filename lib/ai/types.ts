// Shared AI types. Kept free of server-only imports so prompts and tests can use them.

export type AiPurpose = "refine" | "chat_public" | "chat_internal" | "rundown" | "checklist";

/** Mirrors the ai_calls.status check constraint. */
export type AiStatus = "ok" | "timeout" | "rate_limited" | "blocked" | "error" | "invalid_output";

export interface TransportRequest {
  model: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
  /** Sampling settings per purpose (GENERATION in lib/ai/client.ts). */
  temperature: number;
  maxOutputTokens: number;
}

export interface TransportResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Set when the provider refused the prompt or stopped the answer for safety reasons. */
  blockReason?: string;
}

/** One provider call. Throws AiTransportError for HTTP failures; aborts when `signal` fires. */
export interface AiTransport {
  generate(req: TransportRequest): Promise<TransportResponse>;
}

export class AiTransportError extends Error {
  constructor(
    readonly httpStatus: number | undefined,
    readonly code: string,
  ) {
    super(`ai transport error: ${code}`);
    this.name = "AiTransportError";
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; paths: string[] };
