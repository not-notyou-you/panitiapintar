import { AnswerText } from "./AnswerText";
import type { ChatMessage } from "./types";

export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <span className="sr-only">Kamu: </span>
        {message.text}
      </div>
    );
  }
  if (message.kind === "error") {
    return (
      <div className="msg msg-error" role="alert">
        <span className="sr-only">Galat: </span>
        <p>{message.text}</p>
        {message.requestId ? (
          <span className="src">
            Kode permintaan: <code className="select-all">{message.requestId}</code>
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="msg msg-bot">
      <span className="sr-only">Chatbot: </span>
      {message.containsInternal ? (
        <span className="badge badge-internal mb-2 inline-block">INTERNAL · jangan dibagikan ke publik</span>
      ) : null}
      <AnswerText text={message.text} />
      {message.sources && message.sources.length > 0 ? (
        <span className="src">
          <span className="src-label">SUMBER</span>
          {message.sources.map((s) => s.title).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}
