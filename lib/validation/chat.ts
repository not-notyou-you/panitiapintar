import { z } from "zod";

export const SLUG = /^[a-z0-9-]{1,60}$/;
export const slugSchema = z.string().regex(SLUG);

// API.md §2 POST /api/chat/public. History from the browser is untrusted (SEC-06).
export const publicChatRequestSchema = z.strictObject({
  slug: slugSchema,
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.strictObject({ role: z.enum(["user", "model"]), text: z.string().max(1000) }))
    .max(6)
    .default([]),
  turnstileToken: z.string().max(2048).optional(),
});

export type PublicChatRequest = z.infer<typeof publicChatRequestSchema>;

export interface PublicChatResponse {
  answer: string;
  answered: boolean;
  sources: { documentId: string; title: string }[];
  requestId: string;
}
