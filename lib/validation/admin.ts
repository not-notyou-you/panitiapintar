import { z } from "zod";

// Server action / route inputs for phase 2 (API.md §2). Every external value passes through here.

export const uuidSchema = z.uuid();
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const version = z.coerce.number().int().min(1).max(2_147_483_647);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const committeeSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const createCommitteeSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: committeeSlugSchema,
  eventDate: z.iso
    .date()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  location: optionalText(200),
  contactPublic: z.string().trim().min(1).max(200),
});

export const updateCommitteeSchema = createCommitteeSchema
  .omit({ slug: true })
  .extend({ committeeId: uuidSchema });
export const archiveCommitteeSchema = z.object({ committeeId: uuidSchema });

export const REJECT_REASONS = [
  "tidak_akurat",
  "tidak_relevan",
  "data_pribadi",
  "duplikat",
  "lainnya",
] as const;

export const approveDocumentSchema = z.object({
  documentId: uuidSchema,
  expectedVersion: version,
  editedContent: z.string().max(200_000).optional(),
});
export const editApprovedDocumentSchema = z.object({
  documentId: uuidSchema,
  expectedVersion: version,
  content: z.string().trim().min(1).max(200_000),
});
export const rejectDocumentSchema = z.object({
  documentId: uuidSchema,
  expectedVersion: version,
  reasonCategory: z.enum(REJECT_REASONS),
});
export const setVisibilitySchema = z.object({
  documentId: uuidSchema,
  expectedVersion: version,
  visibility: z.enum(["internal", "public"]),
});
export const deleteDocumentSchema = z.object({ documentId: uuidSchema });

export const memberRoleSchema = z.enum(["admin", "member"]);
export const inviteMemberSchema = z.object({
  committeeId: uuidSchema,
  email: emailSchema,
  role: memberRoleSchema,
});
export const changeMemberRoleSchema = z.object({
  committeeId: uuidSchema,
  userId: uuidSchema,
  role: memberRoleSchema,
});
export const removeMemberSchema = z.object({ committeeId: uuidSchema, userId: uuidSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "Kata sandi baru minimal 8 karakter.").max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  next: z.string().max(200).optional(),
});

export const uploadFieldsSchema = z.object({
  committeeId: uuidSchema,
  title: z.string().trim().min(1).max(150),
});

export const qrQuerySchema = z.object({
  format: z.enum(["png", "svg"]).default("png"),
  size: z.coerce
    .number()
    .pipe(z.union([z.literal(512), z.literal(1024)]))
    .default(512),
});

/** Only same-site paths into the logged-in areas; anything else falls back (no open redirect). */
export function safeNextPath(next: string | null | undefined, fallback = "/panitia"): string {
  if (!next || !/^\/(panitia|admin)(\/[A-Za-z0-9\-/]*)?$/.test(next) || next.includes("//")) return fallback;
  return next;
}
