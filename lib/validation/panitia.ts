import { z } from "zod";

// API.md §2: POST /api/chat/internal and POST /api/generate/[kind]. Every field is untrusted input.

const committeeId = z.uuid();
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const internalChatRequestSchema = z.strictObject({
  committeeId,
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.strictObject({ role: z.enum(["user", "model"]), text: z.string().max(2000) }))
    .max(10)
    .default([]),
});
export type InternalChatRequest = z.infer<typeof internalChatRequestSchema>;

export interface InternalChatResponse {
  answer: string;
  answered: boolean;
  sources: { documentId: string; title: string }[];
  containsInternal: boolean;
  requestId: string;
}

export const generateKindSchema = z.enum(["rundown", "checklist"]);
export type GenerateKind = z.infer<typeof generateKindSchema>;

export const rundownRequestSchema = z
  .strictObject({
    committeeId,
    eventDate: date,
    start: time,
    end: time,
    activities: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.start < v.end, { path: ["end"], message: "end must be after start" });
export type RundownRequest = z.infer<typeof rundownRequestSchema>;

export const checklistRequestSchema = z.strictObject({
  committeeId,
  eventDate: date,
  divisions: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type ChecklistRequest = z.infer<typeof checklistRequestSchema>;

export const DUE_ORDER = ["H-30", "H-14", "H-7", "H-3", "H-1", "H"] as const;
export type Due = (typeof DUE_ORDER)[number];

export interface RundownRow {
  time: string;
  durationMin: number;
  activity: string;
  pic: string;
}
export interface ChecklistItem {
  due: Due;
  division: string;
  task: string;
}
