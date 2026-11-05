import "server-only";
import { requireMembership, requireRole } from "@/lib/auth/guards";
import { AppError } from "@/lib/http/errors";
import { archiveCommitteeSchema, createCommitteeSchema, updateCommitteeSchema } from "@/lib/validation/admin";
import { dbError, runAction, type ActionCtx } from "./runtime";

// F1 / FR-A1. Super admin creates and archives; committee admins may edit the descriptive fields.
// slug is fixed after creation (printed on QR codes); status changes only via archive_committee().

const FIELD_NAMES = { name: "name", eventDate: "event_date", location: "location", contactPublic: "contact_public" };

export function createCommittee(raw: unknown, ctx: ActionCtx) {
  return runAction("createCommittee", ctx, createCommitteeSchema, raw, async (input, g) => {
    const user = await requireRole("super_admin", g);
    const { data, error } = await ctx.client
      .from("committees")
      .insert({
        name: input.name,
        slug: input.slug,
        event_date: input.eventDate ?? null,
        location: input.location ?? null,
        contact_public: input.contactPublic,
        created_by: user.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new AppError("CONFLICT", "Slug sudah dipakai acara lain.");
      throw dbError(error);
    }
    const committeeId = data.id as string;
    ctx.log.info({ event: "committee.created", committeeId }, "committee created");
    await ctx.audit({
      action: "committee.create",
      actorId: user.userId,
      actorRole: "super_admin",
      targetType: "committee",
      targetId: committeeId,
      committeeId,
      outcome: "success",
      metadata: { fields: Object.values(FIELD_NAMES).concat("slug") },
      requestId: ctx.requestId,
    });
    return { committeeId, slug: input.slug };
  });
}

export function updateCommittee(raw: unknown, ctx: ActionCtx) {
  return runAction("updateCommittee", ctx, updateCommitteeSchema, raw, async (input, g) => {
    const actor = await requireMembership(input.committeeId, "admin", g);
    const { data: before } = await ctx.client
      .from("committees")
      .select("name, event_date, location, contact_public")
      .eq("id", input.committeeId)
      .maybeSingle();
    if (!before) throw new AppError("NOT_FOUND");
    const next = {
      name: input.name,
      event_date: input.eventDate ?? null,
      location: input.location ?? null,
      contact_public: input.contactPublic,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => before[k] !== next[k]);
    if (changed.length === 0) return { changed };
    const { data, error } = await ctx.client
      .from("committees")
      .update({ ...next, updated_at: new Date().toISOString() })
      .eq("id", input.committeeId)
      .select("id");
    if (error) throw dbError(error);
    if ((data ?? []).length !== 1) throw new AppError("FORBIDDEN");
    ctx.log.info({ event: "committee.updated", committeeId: input.committeeId }, "committee updated");
    await ctx.audit({
      action: "committee.update",
      actorId: actor.userId,
      actorRole: actor.actorRole,
      targetType: "committee",
      targetId: input.committeeId,
      committeeId: input.committeeId,
      outcome: "success",
      metadata: { fields: changed },
      requestId: ctx.requestId,
    });
    return { changed };
  });
}

export function archiveCommittee(raw: unknown, ctx: ActionCtx) {
  return runAction("archiveCommittee", ctx, archiveCommitteeSchema, raw, async (input, g) => {
    await requireRole("super_admin", g);
    // Audit is written inside the RPC, in the same transaction.
    const { error } = await ctx.client.rpc("archive_committee", {
      p_committee: input.committeeId,
      p_request_id: ctx.requestId,
    });
    if (error) throw dbError(error);
    ctx.log.info({ event: "committee.archived", committeeId: input.committeeId }, "committee archived");
    return { committeeId: input.committeeId };
  });
}
