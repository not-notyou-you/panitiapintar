import "server-only";
// POST /api/chat/public business logic: ARCHITECTURE.md §5.1 steps 2–10.
// Dependencies are injected so the security tests can drive every branch without Gemini or a DB.
import type { Logger } from "pino";
import { findCanary } from "@/lib/ai/canary";
import type { GenerateInput, GenerateResult } from "@/lib/ai/client";
import {
  assembleChatPublicPrompt,
  notFoundMessage,
  parseChatPublicOutput,
  type ChatPublicOutput,
  type ContextDoc,
} from "@/lib/ai/prompts/chat-public";
import type { ChatLogRow } from "@/lib/chat/chat-log";
import type { PublicCommitteeRow } from "@/lib/context/public";
import { errorBody, type ErrorCode } from "@/lib/http/errors";
import type { AuditEntry } from "@/lib/log/audit-schema";
import { mergeCounts, redact, type PiiCounts } from "@/lib/privacy";
import type { RateLimitBucket, RateLimitResult } from "@/lib/rate-limit";
import type { PublicChatRequest, PublicChatResponse } from "@/lib/validation/chat";

export const BLOCKED_MESSAGE = "Tidak dapat menjawab pertanyaan ini.";
export const CANARY_MESSAGE = "Maaf, jawaban ini tidak dapat ditampilkan.";
export const NO_DOCS_MESSAGE = "Panitia belum menerbitkan dokumen untuk acara ini.";

export interface PublicChatDeps {
  log: Logger;
  requestId: string;
  ipHash: string;
  rateLimit: (bucket: RateLimitBucket, key: string) => Promise<RateLimitResult>;
  findCommittee: (slug: string) => Promise<PublicCommitteeRow | null>;
  loadContext: (slug: string) => Promise<ContextDoc[]>;
  generate: (input: GenerateInput<ChatPublicOutput>) => Promise<GenerateResult<ChatPublicOutput>>;
  saveChatLog: (row: ChatLogRow) => Promise<void>;
  audit: (entry: AuditEntry) => Promise<void>;
  now?: () => number;
}

export interface HandlerResult {
  status: number;
  body: PublicChatResponse | ReturnType<typeof errorBody>;
  headers?: Record<string, string>;
}

const fail = (code: ErrorCode, status: number, requestId: string, headers?: Record<string, string>) => ({
  status,
  body: errorBody(code, requestId),
  headers,
});

function rateLimited(r: Extract<RateLimitResult, { ok: false }>, requestId: string): HandlerResult {
  return fail("RATE_LIMITED", 429, requestId, { "Retry-After": String(r.retryAfterSeconds) });
}

function logPii(log: Logger, stage: "input" | "history" | "output", found: PiiCounts) {
  const types = Object.keys(found);
  if (types.length === 0) return;
  const count = Object.values(found).reduce((a, b) => a + (b ?? 0), 0);
  log.info({ event: "chat.pii.redacted", types, count, stage }, "pii redacted");
}

export async function handlePublicChat(
  input: PublicChatRequest,
  deps: PublicChatDeps,
): Promise<HandlerResult> {
  const { log, requestId } = deps;
  const now = deps.now ?? (() => performance.now());
  const started = now();

  // 3. Per-IP limit before touching anything else.
  const ipLimit = await deps.rateLimit("chat_public", deps.ipHash);
  if (!ipLimit.ok) return rateLimited(ipLimit, requestId);

  // 4. Committee exists and is active. Archived and unknown look the same from outside (API.md: 404).
  const committee = await deps.findCommittee(input.slug);
  if (!committee) return fail("NOT_FOUND", 404, requestId);
  const clog = log.child({ committeeId: committee.id });
  if (committee.status !== "active") {
    clog.info({ event: "chat.public.unavailable", reason: "committee_archived" }, "chat unavailable");
    return fail("NOT_FOUND", 404, requestId);
  }

  const eventLimit = await deps.rateLimit("chat_public_event", committee.id);
  if (!eventLimit.ok) return rateLimited(eventLimit, requestId);

  clog.debug(
    {
      event: "chat.public.received",
      messageLength: input.message.length,
      historyTurns: input.history.length,
    },
    "chat received",
  );

  // 6. Context only from public_context(slug).
  const docs = await deps.loadContext(input.slug);
  const questionRedacted = redact(input.message);
  if (docs.length === 0) {
    clog.info({ event: "chat.public.unavailable", reason: "no_public_docs" }, "chat unavailable");
    return {
      status: 200,
      body: { answer: NO_DOCS_MESSAGE, answered: false, sources: [], requestId },
    };
  }

  // 5 + 7. Assembly redacts question, history and documents itself, then wraps them in delimiters.
  const prompt = assembleChatPublicPrompt({
    committee,
    docs,
    question: input.message,
    history: input.history,
  });
  logPii(clog, "input", prompt.pii.input);
  logPii(clog, "history", prompt.pii.history);

  const result = await deps.generate({
    purpose: "chat_public",
    role: "chat",
    system: prompt.system,
    prompt: prompt.prompt,
    parse: parseChatPublicOutput,
    requestId,
    committeeId: committee.id,
    contextDocIds: prompt.contextDocIds,
    log: clog,
  });

  if (result.status === "rate_limited") {
    return fail("RATE_LIMITED", 429, requestId, { "Retry-After": "60" });
  }
  if (result.status === "timeout" || result.status === "error" || result.status === "invalid_output") {
    return fail("AI_UNAVAILABLE", 502, requestId);
  }

  const piiTypes: PiiCounts = mergeCounts(mergeCounts({}, prompt.pii.input), prompt.pii.history);
  let answer: string;
  let answered: boolean;
  let sources: PublicChatResponse["sources"] = [];

  const output = result.status === "ok" ? result.value : null;
  if (!output) {
    answer = BLOCKED_MESSAGE;
    answered = false;
  } else if (output.kind === "not_found") {
    answer = notFoundMessage(committee.contact_public);
    answered = false;
  } else {
    // 8. Output guard: redact, then canary detection (SEC-02).
    const out = redact(output.answer);
    logPii(clog, "output", out.found);
    mergeCounts(piiTypes, out.found);
    const canary = findCanary(output.answer) ?? findCanary(out.text);
    if (canary) {
      clog.fatal(
        { event: "security.canary.leaked", committeeId: committee.id, canaryId: canary },
        "canary leaked",
      );
      await deps.audit({
        action: "security.canary_leaked",
        actorId: null,
        actorRole: "system",
        targetType: "committee",
        targetId: committee.id,
        committeeId: committee.id,
        outcome: "failure",
        metadata: { canaryId: canary, mode: "public" },
        requestId,
      });
      answer = `${CANARY_MESSAGE} Hubungi narahubung: ${committee.contact_public}`;
      answered = false;
    } else {
      answer = out.text;
      answered = true;
      const titles = new Map(docs.map((d) => [d.document_id, d.title]));
      const allowed = new Set(prompt.contextDocIds);
      sources = [...new Set(output.sourceDocIds)]
        .filter((id) => allowed.has(id))
        .map((id) => ({ documentId: id, title: titles.get(id) ?? "" }));
    }
  }

  // 9. Persist redacted text only. A logging failure never hides the answer from the visitor.
  const piiRedacted = Object.keys(piiTypes);
  try {
    await deps.saveChatLog({
      committee_id: committee.id,
      mode: "public",
      user_id: null,
      question_redacted: prompt.questionRedacted || questionRedacted.text,
      answered,
      source_doc_ids: sources.map((s) => s.documentId),
      pii_types_redacted: piiRedacted,
      request_id: requestId,
    });
  } catch {
    clog.error({ event: "chat.log.write_failed", mode: "public" }, "chat_logs write failed");
  }
  clog.info(
    {
      event: "chat.public.answered",
      answered,
      sourceCount: sources.length,
      piiRedacted,
      durationMs: Math.round(now() - started),
    },
    "chat answered",
  );

  // 10.
  return { status: 200, body: { answer, answered, sources, requestId } };
}
