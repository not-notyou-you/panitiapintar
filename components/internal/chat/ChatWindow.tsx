"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { stripPii, useChatSession } from "@/lib/chat/use-chat-session";
import { ChatBubble } from "./ChatBubble";
import { PiiWarning } from "./PiiWarning";

import { TypingIndicator } from "./TypingIndicator";

const SUGGESTIONS = [
  "Apa keputusan rapat terakhir?",
  "Berapa anggaran tiap divisi?",
  "Siapa PIC tiap divisi?",
];

// Visuals only. Sending, history limits and the PII check come from useChatSession (lib/chat).
export function ChatWindow({ committeeId }: { committeeId: string }) {
  const chat = useChatSession({ mode: "internal", committeeId });
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.messages, chat.pending]);

  async function sendNow(text: string) {
    setDraft("");
    await chat.send(text);
    inputRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (chat.submit(draft)) setDraft("");
  }

  return (
    <div className="flex flex-col gap-3">
      {chat.messages.length === 0 ? (
        <div>
          <p className="text-mut m-0 mb-2 text-xs">Coba tanyakan:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                onClick={() => void sendNow(s)}
                disabled={chat.pending}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Percakapan"
        className="flex max-h-[60dvh] min-h-[200px] flex-col gap-3 overflow-y-auto py-1 pr-1"
      >
        {chat.messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {chat.pending ? <TypingIndicator /> : null}
      </div>

      {chat.pii ? (
        <PiiWarning
          found={chat.pii}
          onRemove={() => {
            setDraft(stripPii(draft));
            chat.clearPii();
            inputRef.current?.focus();
          }}
          onSendAnyway={() => void sendNow(draft)}
        />
      ) : null}

      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Pertanyaan
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          className="field"
          placeholder="Tulis pertanyaan atau instruksi…"
          value={draft}
          maxLength={chat.limits.maxLen}
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value);
            if (chat.pii) chat.clearPii();
          }}
        />
        <button
          type="submit"
          className="btn min-w-[44px]"
          disabled={chat.pending || draft.trim() === ""}
          aria-label="Kirim"
        >
          <span aria-hidden="true">▶</span>
        </button>
      </form>
    </div>
  );
}
