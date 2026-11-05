"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PII_LABELS, redact, scanPii, type PiiCounts } from "@/lib/privacy";
import { ChatBubble } from "./ChatBubble";
import { PiiWarning } from "./PiiWarning";
import { PrivacyBanner } from "./PrivacyBanner";
import { TypingIndicator } from "./TypingIndicator";
import type { ChatMessage, ChatSource } from "./types";

const PUBLIC_SUGGESTIONS = ["Jam berapa acara mulai?", "Di mana lokasinya?", "Apa dress code-nya?"];
const INTERNAL_SUGGESTIONS = [
  "Apa keputusan rapat terakhir?",
  "Berapa anggaran tiap divisi?",
  "Siapa PIC tiap divisi?",
];
const CLIENT_TIMEOUT_MS = 45_000;

interface ApiOk {
  answer: string;
  answered: boolean;
  sources: ChatSource[];
  containsInternal?: boolean;
  requestId: string;
}
interface ApiErr {
  error: { code: string; message: string; requestId: string };
}

let seq = 0;
const nextId = () => `m${++seq}`;

/** Strips detected PII from the draft: same patterns as the server, labels removed. */
function stripPii(text: string): string {
  let out = redact(text).text;
  for (const label of Object.values(PII_LABELS)) out = out.split(label).join("");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** Public mode passes `slug`; Mode Panitia passes `committeeId` (POST /api/chat/internal, API.md §2). */
export function ChatWindow(props: { slug: string } | { committeeId: string }) {
  const internal = "committeeId" in props;
  const MAX_LEN = internal ? 2000 : 1000;
  const MAX_HISTORY = internal ? 10 : 6;
  const SUGGESTIONS = internal ? INTERNAL_SUGGESTIONS : PUBLIC_SUGGESTIONS;
  // History lives only in this component's state: never stored in the browser or sent anywhere else.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [pii, setPii] = useState<PiiCounts | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, pending]);

  function history() {
    return messages
      .filter((m) => m.role === "user" || m.kind === "answer")
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        text: m.text.slice(0, MAX_LEN),
      }));
  }

  async function send(text: string) {
    const message = text.trim().slice(0, MAX_LEN);
    if (!message || pending) return;
    const priorHistory = history();
    setMessages((m) => [...m, { id: nextId(), role: "user", text: message }]);
    setDraft("");
    setPii(null);
    setPending(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let reply: ChatMessage;
    try {
      const target = internal
        ? {
            url: "/api/chat/internal",
            body: { committeeId: props.committeeId, message, history: priorHistory },
          }
        : { url: "/api/chat/public", body: { slug: props.slug, message, history: priorHistory } };
      const res = await fetch(target.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target.body),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as ApiOk | ApiErr | null;
      if (res.ok && data && "answer" in data) {
        reply = {
          id: nextId(),
          role: "bot",
          kind: data.answered ? "answer" : "unanswered",
          text: data.answer,
          sources: data.sources,
          containsInternal: data.containsInternal === true,
          requestId: data.requestId,
        };
      } else {
        const err = data && "error" in data ? data.error : null;
        reply = {
          id: nextId(),
          role: "bot",
          kind: "error",
          text: err?.message ?? "Terjadi kesalahan. Coba lagi nanti.",
          requestId: err?.requestId ?? res.headers.get("x-request-id") ?? undefined,
        };
      }
    } catch {
      reply = {
        id: nextId(),
        role: "bot",
        kind: "error",
        text: controller.signal.aborted
          ? "Chatbot terlalu lama menjawab. Coba lagi."
          : "Tidak dapat terhubung. Periksa koneksi internetmu.",
      };
    } finally {
      clearTimeout(timer);
    }
    setMessages((m) => [...m, reply]);
    setPending(false);
    inputRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const scan = scanPii(draft);
    if (scan.total > 0) {
      setPii(scan.found);
      return;
    }
    void send(draft);
  }

  return (
    <div className="flex flex-col gap-3">
      {internal ? null : <PrivacyBanner />}

      {messages.length === 0 ? (
        <div>
          <p className="text-mut m-0 mb-2 text-xs">Coba tanyakan:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void send(s)} disabled={pending}>
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
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {pending ? <TypingIndicator /> : null}
      </div>

      {pii ? (
        <PiiWarning
          found={pii}
          onRemove={() => {
            setDraft(stripPii(draft));
            setPii(null);
            inputRef.current?.focus();
          }}
          onSendAnyway={() => void send(draft)}
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
          placeholder={internal ? "Tulis pertanyaan atau instruksi…" : "Tulis pertanyaan tentang acara ini…"}
          value={draft}
          maxLength={MAX_LEN}
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value);
            if (pii) setPii(null);
          }}
        />
        <button
          type="submit"
          className="btn min-w-[44px]"
          disabled={pending || draft.trim() === ""}
          aria-label="Kirim"
        >
          <span aria-hidden="true">▶</span>
        </button>
      </form>
    </div>
  );
}
