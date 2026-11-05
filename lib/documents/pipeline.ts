import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { GenerateInput, GenerateResult } from "@/lib/ai/client";
import {
  assembleRefinePrompt,
  parseRefineOutput,
  renderRefinedMarkdown,
  type RefineOutput,
} from "@/lib/ai/prompts/refine";
import { scanPii } from "@/lib/privacy";

// ARCHITECTURE §5.3 steps 5–6. Runs with the service role: the status moves refining →
// needs_review / refine_failed are system transitions that the guard trigger reserves for it (0004).

export const REFINE_TIMEOUT_MS = 45_000;
/** A document stuck in `refining` longer than this (e.g. the function was killed) counts as failed. */
export const STALE_REFINING_MS = 3 * 60_000;

export interface PipelineDeps {
  svc: SupabaseClient;
  generate: (input: GenerateInput<RefineOutput>) => Promise<GenerateResult<RefineOutput>>;
  log: Logger;
  requestId: string;
}

interface DocRow {
  id: string;
  committee_id: string;
  title: string;
  status: string;
  version: number;
}

/** Moves a document between pipeline states, only if nobody changed it meanwhile. */
async function transition(
  svc: SupabaseClient,
  doc: DocRow,
  patch: { status: "needs_review" | "refine_failed" | "refining"; status_reason?: string | null },
): Promise<boolean> {
  const { data, error } = await svc
    .from("documents")
    .update({ ...patch, version: doc.version + 1, updated_at: new Date().toISOString() })
    .eq("id", doc.id)
    .eq("version", doc.version)
    .select("id");
  if (error) throw new Error(`pipeline transition failed: ${error.code}`);
  return (data ?? []).length === 1;
}

export async function refineDocument(documentId: string, deps: PipelineDeps): Promise<string> {
  const { svc, log } = deps;
  const { data: doc } = await svc
    .from("documents")
    .select("id, committee_id, title, status, version")
    .eq("id", documentId)
    .maybeSingle<DocRow>();
  if (!doc || doc.status !== "refining") return doc?.status ?? "missing";

  try {
    const { data: source } = await svc
      .from("document_versions")
      .select("content")
      .eq("document_id", documentId)
      .eq("kind", "original_redacted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ content: string }>();
    if (!source) throw new Error("missing original_redacted");

    log.info({ event: "document.refine.started", documentId }, "refine started");
    const { system, prompt } = assembleRefinePrompt({ title: doc.title, content: source.content });
    const result = await deps.generate({
      purpose: "refine",
      role: "refine",
      system,
      prompt,
      parse: parseRefineOutput,
      requestId: deps.requestId,
      committeeId: doc.committee_id,
      contextDocIds: [documentId],
      log,
      timeoutMs: REFINE_TIMEOUT_MS,
    });

    if (result.status !== "ok") {
      log.error({ event: "document.refine.failed", documentId, error: { code: result.status } }, "refine failed");
      const reason = result.status === "invalid_output" ? "ai_invalid_output" : "ai_unavailable";
      await transition(svc, doc, { status: "refine_failed", status_reason: reason });
      return "refine_failed";
    }

    const markdown = renderRefinedMarkdown(result.value);
    const { error: vErr } = await svc.from("document_versions").insert({
      document_id: documentId,
      kind: "ai_refined",
      content: markdown,
      pii_summary: scanPii(markdown).found,
    });
    if (vErr) throw new Error(`version insert failed: ${vErr.code}`);
    await transition(svc, doc, { status: "needs_review", status_reason: null });
    log.info(
      {
        event: "document.refine.completed",
        documentId,
        sections: result.value.sections.length,
        faqCount: result.value.faq.length,
      },
      "refine completed",
    );
    return "needs_review";
  } catch (err) {
    log.error(
      { event: "document.refine.failed", documentId, error: { code: err instanceof Error ? err.name : "unknown" } },
      "refine crashed",
    );
    await transition(svc, doc, { status: "refine_failed", status_reason: "internal" }).catch(() => false);
    return "refine_failed";
  }
}

/** Marks a long-stuck `refining` document as failed so the admin can retry. */
export async function failIfStale(
  svc: SupabaseClient,
  doc: DocRow & { updated_at: string },
  now: number = Date.now(),
): Promise<boolean> {
  if (doc.status !== "refining" || now - Date.parse(doc.updated_at) < STALE_REFINING_MS) return false;
  return transition(svc, doc, { status: "refine_failed", status_reason: "timeout" });
}
