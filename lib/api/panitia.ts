import "server-only";
// Mode Panitia routes: POST /api/chat/internal and POST /api/generate/[kind] (ARCHITECTURE §5.2).
// Same pipeline as the public chat, but: membership instead of "event is active", rate limit per user,
// context through the user's JWT (RLS), and no canary check (members may read internal documents).
import type { Logger } from "pino";
import { NextResponse } from "next/server";
import type { GenerateInput, GenerateResult } from "@/lib/ai/client";
import { notFoundMessage, type AssembledPrompt } from "@/lib/ai/prompts/chat-public";
import { assembleChatInternalPrompt, parseChatInternalOutput } from "@/lib/ai/prompts/chat-internal";
import {
  assembleChecklistPrompt,
  assembleRundownPrompt,
  parseChecklistOutput,
  parseRundownOutput,
} from "@/lib/ai/prompts/generate";
import type { AiStatus, ParseResult } from "@/lib/ai/types";
import { requireMembership } from "@/lib/auth/guards";
import type { ChatLogRow } from "@/lib/chat/chat-log";
import {
  InternalDataUnavailableError,
  loadInternalContext,
  type InternalContext,
} from "@/lib/context/internal";
import { AppError } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { mergeCounts, redact, type PiiCounts } from "@/lib/privacy";
import { RateLimitUnavailableError, type RateLimitResult } from "@/lib/rate-limit";
import {
  checklistRequestSchema,
  generateKindSchema,
  internalChatRequestSchema,
  rundownRequestSchema,
  type InternalChatResponse,
} from "@/lib/validation/panitia";
import { RateLimitedError, respond, routeGuard, type RouteDeps } from "./respond";

export const MAX_JSON_BYTES = 32 * 1024;
export const NO_APPROVED_DOCS = "Belum ada dokumen yang disetujui untuk kepanitiaan ini.";
const BLOCKED = "Tidak dapat menjawab pertanyaan ini.";

export interface PanitiaDeps extends RouteDeps {
  rateLimit: (bucket: "chat_internal", key: string) => Promise<RateLimitResult>;
  generate: <T>(input: GenerateInput<T>) => Promise<GenerateResult<T>>;
  saveChatLog: (row: ChatLogRow) => Promise<void>;
  loadContext?: typeof loadInternalContext;
}

async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_JSON_BYTES)
    throw new AppError("PAYLOAD_TOO_LARGE");
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_INPUT");
  }
}

/** Origin → size → zod → membership (real members only) → per-user limit → context. */
async function prepare<S extends { committeeId: string }>(
  req: Request,
  deps: PanitiaDeps,
  route: string,
  parse: (body: unknown) => { success: true; data: S } | { success: false },
): Promise<{ input: S; userId: string; ctx: InternalContext; log: Logger }> {
  assertSameOrigin(req.headers.get("origin"), deps.appUrl, deps.log);
  const parsed = parse(await readJson(req));
  if (!parsed.success) throw new AppError("INVALID_INPUT");
  const input = parsed.data;
  const actor = await requireMembership(input.committeeId, undefined, routeGuard(deps, route), {
    realMemberOnly: true,
  });
  let ctx: InternalContext | null;
  try {
    const rl = await deps.rateLimit("chat_internal", actor.userId);
    if (!rl.ok) throw new RateLimitedError(rl.retryAfterSeconds);
    ctx = await (deps.loadContext ?? loadInternalContext)(deps.client, input.committeeId);
  } catch (err) {
    if (err instanceof RateLimitUnavailableError || err instanceof InternalDataUnavailableError) {
      deps.log.error(
        { event: "http.request.failed", status: 503, error: { code: err.name } },
        "dependency down",
      );
      throw new AppError("SERVICE_UNAVAILABLE");
    }
    throw err;
  }
  if (!ctx) throw new AppError("NOT_FOUND");
  return { input, userId: actor.userId, ctx, log: deps.log.child({ committeeId: input.committeeId }) };
}

function logPii(log: Logger, stage: "input" | "history" | "output", found: PiiCounts) {
  const types = Object.keys(found);
  if (types.length === 0) return;
  const count = Object.values(found).reduce((a, b) => a + (b ?? 0), 0);
  log.info({ event: "chat.pii.redacted", types, count, stage }, "pii redacted");
}

function aiFailure(status: Exclude<AiStatus, "ok" | "blocked">): AppError {
  return status === "rate_limited" ? new RateLimitedError(60) : new AppError("AI_UNAVAILABLE");
}

async function writeChatLog(deps: PanitiaDeps, log: Logger, row: ChatLogRow) {
  try {
    await deps.saveChatLog(row);
  } catch {
    log.error({ event: "chat.log.write_failed", mode: row.mode }, "chat_logs write failed");
  }
}

const ROUTE_CHAT = "POST /api/chat/internal";

export function handleInternalChat(req: Request, deps: PanitiaDeps): Promise<Response> {
  return respond(deps, async () => {
    const { input, userId, ctx, log } = await prepare(req, deps, ROUTE_CHAT, (b) =>
      internalChatRequestSchema.safeParse(b),
    );
    const { requestId } = deps;
    const reply = (body: Omit<InternalChatResponse, "requestId">) =>
      NextResponse.json({ ...body, requestId } satisfies InternalChatResponse);

    if (ctx.docs.length === 0) {
      return reply({ answer: NO_APPROVED_DOCS, answered: false, sources: [], containsInternal: false });
    }

    const prompt = assembleChatInternalPrompt({
      committeeName: ctx.committee.name,
      docs: ctx.docs,
      question: input.message,
      history: input.history,
    });
    logPii(log, "input", prompt.pii.input);
    logPii(log, "history", prompt.pii.history);

    const result = await deps.generate({
      purpose: "chat_internal",
      role: "chat",
      system: prompt.system,
      prompt: prompt.prompt,
      parse: parseChatInternalOutput,
      requestId,
      committeeId: ctx.committee.id,
      contextDocIds: prompt.contextDocIds,
      log,
    });
    if (result.status !== "ok" && result.status !== "blocked") throw aiFailure(result.status);

    const piiTypes = mergeCounts(mergeCounts({}, prompt.pii.input), prompt.pii.history);
    let answer = BLOCKED;
    let answered = false;
    let sources: InternalChatResponse["sources"] = [];
    if (result.status === "ok" && result.value.kind === "not_found") {
      answer = notFoundMessage("koordinator kepanitiaan");
    } else if (result.status === "ok" && result.value.kind === "answer") {
      const out = redact(result.value.answer); // SEC-02 output guard
      logPii(log, "output", out.found);
      mergeCounts(piiTypes, out.found);
      answer = out.text;
      answered = result.value.answered;
      const byId = new Map(ctx.docs.map((d) => [d.document_id, d]));
      const allowed = new Set(prompt.contextDocIds);
      sources = [...new Set(result.value.sourceDocIds)]
        .filter((id) => allowed.has(id))
        .map((id) => ({ documentId: id, title: byId.get(id)?.title ?? "" }));
    }
    // The label follows the cited sources; an uncited answer may still draw on internal context.
    const internalIds = new Set(
      ctx.docs.filter((d) => d.visibility === "internal").map((d) => d.document_id),
    );
    const containsInternal =
      answered &&
      (sources.length > 0
        ? sources.some((s) => internalIds.has(s.documentId))
        : prompt.contextDocIds.some((id) => internalIds.has(id)));

    await writeChatLog(deps, log, {
      committee_id: ctx.committee.id,
      mode: "internal",
      user_id: userId,
      question_redacted: prompt.questionRedacted,
      answered,
      source_doc_ids: sources.map((s) => s.documentId),
      pii_types_redacted: Object.keys(piiTypes),
      request_id: requestId,
    });
    log.info(
      { event: "chat.internal.answered", userId, answered, containsInternal, sourceCount: sources.length },
      "internal chat answered",
    );
    return reply({ answer, answered, sources, containsInternal });
  });
}

export function handleGenerate(kindParam: string, req: Request, deps: PanitiaDeps): Promise<Response> {
  return respond(deps, async () => {
    const kind = generateKindSchema.safeParse(kindParam);
    if (!kind.success) throw new AppError("NOT_FOUND");
    const route = `POST /api/generate/${kind.data}`;
    const { requestId } = deps;

    if (kind.data === "rundown") {
      const { input, userId, ctx, log } = await prepare(req, deps, route, (b) =>
        rundownRequestSchema.safeParse(b),
      );
      const prompt = assembleRundownPrompt(ctx.committee.name, ctx.docs, input);
      const rows = await runGenerator(deps, log, prompt, "rundown", ctx.committee.id, parseRundownOutput);
      const safe = rows.map((r) => ({ ...r, activity: redact(r.activity).text, pic: redact(r.pic).text }));
      await logGenerator(deps, log, prompt, "rundown", ctx.committee.id, userId);
      log.info({ event: "generate.rundown.completed", userId, rows: safe.length }, "rundown generated");
      return NextResponse.json({ rows: safe, requestId });
    }

    const { input, userId, ctx, log } = await prepare(req, deps, route, (b) =>
      checklistRequestSchema.safeParse(b),
    );
    const prompt = assembleChecklistPrompt(ctx.committee.name, ctx.docs, input);
    const items = await runGenerator(deps, log, prompt, "checklist", ctx.committee.id, parseChecklistOutput);
    const safe = items.map((i) => ({ ...i, division: redact(i.division).text, task: redact(i.task).text }));
    await logGenerator(deps, log, prompt, "checklist", ctx.committee.id, userId);
    log.info({ event: "generate.checklist.completed", userId, items: safe.length }, "checklist generated");
    return NextResponse.json({ items: safe, requestId });
  });
}

async function runGenerator<T>(
  deps: PanitiaDeps,
  log: Logger,
  prompt: AssembledPrompt,
  purpose: "rundown" | "checklist",
  committeeId: string,
  parse: (raw: string) => ParseResult<T>,
): Promise<T> {
  logPii(log, "input", prompt.pii.input);
  const result = await deps.generate({
    purpose,
    role: "chat",
    system: prompt.system,
    prompt: prompt.prompt,
    parse,
    requestId: deps.requestId,
    committeeId,
    contextDocIds: prompt.contextDocIds,
    log,
  });
  if (result.status === "ok") return result.value;
  // A generator has no partial answer to show: blocked output is treated as unavailable too.
  throw aiFailure(result.status === "blocked" ? "error" : result.status);
}

function logGenerator(
  deps: PanitiaDeps,
  log: Logger,
  prompt: AssembledPrompt,
  mode: "rundown" | "checklist",
  committeeId: string,
  userId: string,
) {
  return writeChatLog(deps, log, {
    committee_id: committeeId,
    mode,
    user_id: userId,
    question_redacted: prompt.questionRedacted,
    answered: true,
    source_doc_ids: [],
    pii_types_redacted: Object.keys(prompt.pii.input),
    request_id: deps.requestId,
  });
}
