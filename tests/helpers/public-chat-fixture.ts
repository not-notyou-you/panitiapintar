import { vi } from "vitest";
import type { GenerateInput, GenerateResult } from "@/lib/ai/client";
import type { ChatPublicOutput } from "@/lib/ai/prompts/chat-public";
import type { ChatLogRow } from "@/lib/chat/chat-log";
import { handlePublicChat, type PublicChatDeps } from "@/lib/chat/public-chat";
import type { PublicCommitteeRow } from "@/lib/context/public";
import type { AuditEntry } from "@/lib/log/audit-schema";
import type { RateLimitResult } from "@/lib/rate-limit";
import { publicChatRequestSchema } from "@/lib/validation/chat";
import { captureLogger } from "./capture-logger";

export const COMMITTEE: PublicCommitteeRow = {
  id: "00000000-0000-4000-a000-0000000000c1",
  name: "Festival Teknologi Fiktif 2026",
  slug: "festival-teknologi-fiktif",
  event_date: "2026-12-05",
  location: "Aula Utama Gedung C",
  contact_public: "Instagram @festekfiktif",
  status: "active",
};

export const DOCS = [
  {
    document_id: "00000000-0000-4000-a000-0000000000d1",
    title: "Guidebook",
    content: "Lokasi: Aula Utama Gedung C. Parkir motor di basement Gedung B.",
  },
  { document_id: "00000000-0000-4000-a000-0000000000d2", title: "FAQ", content: "Dress code: kasual rapi." },
];

export const REQUEST_ID = "req_01JD00000000000000000000AB";

type Gen = (input: GenerateInput<ChatPublicOutput>) => Promise<GenerateResult<ChatPublicOutput>>;

export const answer = (text: string, ids: string[] = [DOCS[0]!.document_id]): Gen =>
  vi.fn(async () => ({
    status: "ok" as const,
    value: { kind: "answer" as const, answered: true, answer: text, sourceDocIds: ids },
    model: "m",
    fallbackUsed: false,
  }));

export const status = (s: Exclude<GenerateResult<ChatPublicOutput>["status"], "ok">): Gen =>
  vi.fn(async () => ({ status: s, model: "m", fallbackUsed: false }));

export function run(
  body: Record<string, unknown>,
  overrides: Partial<PublicChatDeps> = {},
): Promise<{
  result: Awaited<ReturnType<typeof handlePublicChat>>;
  logs: ReturnType<typeof captureLogger>;
  chatLogs: ChatLogRow[];
  audits: AuditEntry[];
  generate: Gen;
}> {
  const logs = captureLogger("debug");
  const chatLogs: ChatLogRow[] = [];
  const audits: AuditEntry[] = [];
  const generate = overrides.generate ?? answer("Lokasi di Aula Utama Gedung C.");
  const deps: PublicChatDeps = {
    log: logs.log.child({ requestId: REQUEST_ID }),
    requestId: REQUEST_ID,
    ipHash: "iphash",
    rateLimit: async (): Promise<RateLimitResult> => ({ ok: true }),
    findCommittee: async () => COMMITTEE,
    loadContext: async () => DOCS,
    saveChatLog: async (row) => {
      chatLogs.push(row);
    },
    audit: async (entry) => {
      audits.push(entry);
    },
    ...overrides,
    generate,
  };
  const input = publicChatRequestSchema.parse({
    slug: COMMITTEE.slug,
    message: "Di mana lokasinya?",
    ...body,
  });
  return handlePublicChat(input, deps).then((result) => ({ result, logs, chatLogs, audits, generate }));
}
