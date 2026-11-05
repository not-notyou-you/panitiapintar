export interface ChatSource {
  documentId: string;
  title: string;
}

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "bot";
      kind: "answer" | "unanswered" | "error";
      text: string;
      sources?: ChatSource[];
      /** Mode Panitia: the answer drew on internal documents (INTERFACE §4.2 label). */
      containsInternal?: boolean;
      requestId?: string;
    };
