import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDocument, type DocumentRow } from "@/lib/api/respond";
import { requireMembership, requireUser, type GuardDeps, type MembershipContext } from "@/lib/auth/guards";
import { AppError } from "@/lib/http/errors";
import { redact, scanPii } from "@/lib/privacy";
import {
  approveDocumentSchema,
  deleteDocumentSchema,
  editApprovedDocumentSchema,
  rejectDocumentSchema,
  setVisibilitySchema,
} from "@/lib/validation/admin";
import { dbError, runAction, type ActionCtx } from "./runtime";

// SEC-04. Status, visibility and approval change only through the official RPCs (0004/0005), which
// check role + optimistic lock + transition and write audit_logs in the same transaction:
// if the audit insert fails, the whole action rolls back (LOGGING §7, CLAUDE.md rule 10).

async function adminOfDocument(
  documentId: string,
  ctx: ActionCtx,
  g: GuardDeps,
): Promise<{ doc: DocumentRow; actor: MembershipContext }> {
  await requireUser(g);
  const doc = await loadDocument(ctx.client, documentId, ctx.log);
  const actor = await requireMembership(doc.committee_id, "admin", g);
  return { doc, actor };
}

/** Saves an admin edit as a new admin_edited version, redacted again (rule 2 + SEC-05). */
async function insertAdminEdit(client: SupabaseClient, documentId: string, userId: string, content: string) {
  const text = redact(content).text;
  const { data, error } = await client
    .from("document_versions")
    .insert({
      document_id: documentId,
      kind: "admin_edited",
      content: text,
      created_by: userId,
      pii_summary: scanPii(text).found,
    })
    .select("id")
    .single();
  if (error) throw dbError(error);
  return data.id as string;
}

/** The version under review: the newest ai_refined or admin_edited one. */
export async function latestReviewVersion(client: SupabaseClient, documentId: string) {
  const { data, error } = await client
    .from("document_versions")
    .select("id, kind, content, pii_summary, created_at")
    .eq("document_id", documentId)
    .in("kind", ["ai_refined", "admin_edited"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError(error);
  return data as {
    id: string;
    kind: string;
    content: string;
    pii_summary: Record<string, number>;
    created_at: string;
  } | null;
}

export function approveDocument(raw: unknown, ctx: ActionCtx) {
  return runAction("approveDocument", ctx, approveDocumentSchema, raw, async (input, g) => {
    const { doc, actor } = await adminOfDocument(input.documentId, ctx, g);
    if (doc.status !== "needs_review")
      throw new AppError("INVALID_INPUT", "Dokumen tidak sedang menunggu tinjauan.");
    if (doc.version !== input.expectedVersion) throw new AppError("CONFLICT");
    const edited = input.editedContent !== undefined && input.editedContent.trim() !== "";
    let versionId: string;
    if (edited) {
      versionId = await insertAdminEdit(ctx.client, doc.id, actor.userId, input.editedContent ?? "");
    } else {
      const latest = await latestReviewVersion(ctx.client, doc.id);
      if (!latest) throw new AppError("INVALID_INPUT", "Belum ada hasil perapihan untuk disetujui.");
      versionId = latest.id;
    }
    const { data, error } = await ctx.client.rpc("approve_document", {
      p_doc: doc.id,
      p_version_id: versionId,
      p_expected_version: input.expectedVersion,
      p_request_id: ctx.requestId,
    });
    if (error) throw dbError(error);
    ctx.log.info({ event: "document.review.approved", documentId: doc.id, edited }, "document approved");
    return { version: data as number, versionId };
  });
}

export function rejectDocument(raw: unknown, ctx: ActionCtx) {
  return runAction("rejectDocument", ctx, rejectDocumentSchema, raw, async (input, g) => {
    const { doc } = await adminOfDocument(input.documentId, ctx, g);
    const { data, error } = await ctx.client.rpc("reject_document", {
      p_doc: doc.id,
      p_reason_category: input.reasonCategory,
      p_expected_version: input.expectedVersion,
      p_request_id: ctx.requestId,
    });
    if (error) throw dbError(error);
    ctx.log.info({ event: "document.review.rejected", documentId: doc.id }, "document rejected");
    return { version: data as number };
  });
}

/** Edit after approval: new admin_edited version, document back to needs_review + internal (0005). */
export function editApprovedDocument(raw: unknown, ctx: ActionCtx) {
  return runAction("editApprovedDocument", ctx, editApprovedDocumentSchema, raw, async (input, g) => {
    const { doc, actor } = await adminOfDocument(input.documentId, ctx, g);
    if (doc.status !== "approved")
      throw new AppError("INVALID_INPUT", "Hanya dokumen yang disetujui yang bisa diedit di sini.");
    if (doc.version !== input.expectedVersion) throw new AppError("CONFLICT");
    const versionId = await insertAdminEdit(ctx.client, doc.id, actor.userId, input.content);
    const { data, error } = await ctx.client.rpc("reopen_document", {
      p_doc: doc.id,
      p_version_id: versionId,
      p_expected_version: input.expectedVersion,
      p_request_id: ctx.requestId,
    });
    if (error) throw dbError(error);
    if (doc.visibility === "public") {
      ctx.log.info(
        { event: "document.visibility.changed", documentId: doc.id, from: "public", to: "internal" },
        "visibility reset by edit",
      );
    }
    return { version: data as number, versionId };
  });
}

export function setVisibility(raw: unknown, ctx: ActionCtx) {
  return runAction("setVisibility", ctx, setVisibilitySchema, raw, async (input, g) => {
    const { doc } = await adminOfDocument(input.documentId, ctx, g);
    if (input.visibility === "public") {
      // Checked here for a clear message; the RPC enforces both rules again (0005).
      if (doc.status !== "approved")
        throw new AppError("INVALID_INPUT", "Setujui dokumen dulu sebelum dijadikan Publik.");
      const { data: current } = await ctx.client
        .from("document_versions")
        .select("pii_summary")
        .eq("id", doc.current_version_id ?? "")
        .maybeSingle();
      if (!current || Object.keys((current.pii_summary as Record<string, number>) ?? {}).length > 0) {
        throw new AppError(
          "INVALID_INPUT",
          "Masih ada data pribadi di versi ini. Redaksi dulu sebelum dijadikan Publik.",
        );
      }
    }
    const { data, error } = await ctx.client.rpc("set_document_visibility", {
      p_doc: doc.id,
      p_visibility: input.visibility,
      p_expected_version: input.expectedVersion,
      p_request_id: ctx.requestId,
    });
    if (error) throw dbError(error);
    ctx.log.info(
      {
        event: "document.visibility.changed",
        documentId: doc.id,
        from: doc.visibility,
        to: input.visibility,
      },
      "visibility changed",
    );
    return { version: data as number };
  });
}

export function deleteDocument(raw: unknown, ctx: ActionCtx) {
  return runAction("deleteDocument", ctx, deleteDocumentSchema, raw, async (input, g) => {
    const { doc, actor } = await adminOfDocument(input.documentId, ctx, g);
    // File first: a leftover row is visible and can be deleted again; a leftover file would be orphaned.
    const { error: sErr } = await ctx.client.storage.from("documents-raw").remove([doc.storage_path]);
    if (sErr) throw new Error("storage delete failed");
    const { data, error } = await ctx.client.from("documents").delete().eq("id", doc.id).select("id");
    if (error) throw dbError(error);
    if ((data ?? []).length !== 1) throw new AppError("FORBIDDEN");
    ctx.log.info({ event: "document.deleted", documentId: doc.id }, "document deleted");
    await ctx.audit({
      action: "document.delete",
      actorId: actor.userId,
      actorRole: actor.actorRole,
      targetType: "document",
      targetId: doc.id,
      committeeId: doc.committee_id,
      outcome: "success",
      metadata: { status: doc.status },
      requestId: ctx.requestId,
    });
    return { documentId: doc.id };
  });
}
