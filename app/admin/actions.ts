"use server";

// Thin Next server-action wrappers. All logic (origin check, zod, guards, audit) lives in lib/actions.
import { revalidatePath } from "next/cache";
import * as committees from "@/lib/actions/committees";
import * as documents from "@/lib/actions/documents";
import * as members from "@/lib/actions/members";
import type { ActionCtx, ActionResult } from "@/lib/actions/runtime";
import { serverActionCtx } from "@/lib/actions/server-ctx";
import { env } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/service";

async function run<T>(fn: (ctx: ActionCtx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const result = await fn(await serverActionCtx());
  if (result.ok) revalidatePath("/admin", "layout");
  return result;
}

export async function createCommitteeAction(input: unknown) {
  return run((ctx) => committees.createCommittee(input, ctx));
}
export async function updateCommitteeAction(input: unknown) {
  return run((ctx) => committees.updateCommittee(input, ctx));
}
export async function archiveCommitteeAction(input: unknown) {
  return run((ctx) => committees.archiveCommittee(input, ctx));
}

export async function approveDocumentAction(input: unknown) {
  return run((ctx) => documents.approveDocument(input, ctx));
}
export async function rejectDocumentAction(input: unknown) {
  return run((ctx) => documents.rejectDocument(input, ctx));
}
export async function editApprovedDocumentAction(input: unknown) {
  return run((ctx) => documents.editApprovedDocument(input, ctx));
}
export async function setVisibilityAction(input: unknown) {
  return run((ctx) => documents.setVisibility(input, ctx));
}
export async function deleteDocumentAction(input: unknown) {
  return run((ctx) => documents.deleteDocument(input, ctx));
}

export async function inviteMemberAction(input: unknown) {
  const redirectTo = `${new URL(env().APP_URL).origin}/auth/callback?next=/panitia`;
  return run((ctx) =>
    members.inviteMember(input, ctx, members.serviceFindOrInvite(serviceClient(), redirectTo)),
  );
}
export async function changeMemberRoleAction(input: unknown) {
  return run((ctx) => members.changeMemberRole(input, ctx));
}
export async function removeMemberAction(input: unknown) {
  return run((ctx) => members.removeMember(input, ctx));
}
