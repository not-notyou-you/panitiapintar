"use client";
// Headless chat logic shared by the public chat (components/public) and Mode Panitia
// (components/internal). Visual components may differ completely; the safety behaviour may not:
// history caps, client timeout, PII check before sending, and requestId on errors all live here.
import { useRef, useState } from "react";
import { PII_LABELS, redact, scanPii, type PiiCounts } from "@/lib/privacy";

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

export type ChatTarget = { mode: "public"; slug: string } | { mode: "internal"; committeeId: string };

// API.md §2: public 1.000 chars × 6 turns, internal 2.000 × 10.
export const CHAT_LIMITS = {
  public: { maxLen: 1000, maxHistory: 6 },
  internal: { maxLen: 2000, maxHistory: 10 },
} as const;
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

/** Strips detected PII from a draft: same patterns as the server, labels removed. */
export function stripPii(text: string): string {
  let out = redact(text).text;
  for (const label of Object.values(PII_LABELS)) out = out.split(label).join("");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * History lives only in React state: never stored in the browser or sent anywhere else.
 * `submit(draft)` returns false and sets `pii` when the draft looks like personal data; the UI then
 * offers `removePii()` or `send(draft)` ("Kirim tetap"). The server redacts again either way.
 */
export function useChatSession(target: ChatTarget) {
  const limits = CHAT_LIMITS[target.mode];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [pii, setPii] = useState<PiiCounts | null>(null);
  const pendingRef = useRef(false);

  function history() {
    return messages
      .filter((m) => m.role === "user" || m.kind === "answer")
      .slice(-limits.maxHistory)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        text: m.text.slice(0, limits.maxLen),
      }));
  }

  async function send(text: string): Promise<void> {
    const message = text.trim().slice(0, limits.maxLen);
    if (!message || pendingRef.current) return;
    pendingRef.current = true;
    const priorHistory = history();
    setMessages((m) => [...m, { id: nextId(), role: "user", text: message }]);
    setPii(null);
    setPending(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const request =
      target.mode === "internal"
        ? {
            url: "/api/chat/internal",
            body: { committeeId: target.committeeId, message, history: priorHistory },
          }
        : { url: "/api/chat/public", body: { slug: target.slug, message, history: priorHistory } };
    let reply: ChatMessage;
    try {
      const res = await fetch(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
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
    pendingRef.current = false;
  }

  /** Checks the draft for PII first. Returns true when it was sent. */
  function submit(draft: string): boolean {
    const scan = scanPii(draft);
    if (scan.total > 0) {
      setPii(scan.found);
      return false;
    }
    void send(draft);
    return true;
  }

  return {
    messages,
    pending,
    pii,
    limits,
    send,
    submit,
    clearPii: () => setPii(null),
  };
}
