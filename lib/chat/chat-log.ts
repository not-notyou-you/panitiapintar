import "server-only";
import { serviceClient } from "@/lib/supabase/service";

export interface ChatLogRow {
  committee_id: string;
  mode: "public" | "internal" | "rundown" | "checklist";
  user_id: string | null;
  /** Must already be redacted. */
  question_redacted: string;
  answered: boolean;
  source_doc_ids: string[];
  pii_types_redacted: string[];
  request_id: string;
}

// chat_logs has no insert policy: the server writes it with the service role (system task, redacted text only).
export async function saveChatLog(row: ChatLogRow): Promise<void> {
  const { error } = await serviceClient()
    .from("chat_logs")
    .insert({ ...row, question_redacted: row.question_redacted.slice(0, 1000) });
  if (error) throw new Error(`chat_logs insert failed: ${error.code}`);
}
