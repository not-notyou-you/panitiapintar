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
      requestId?: string;
    };
