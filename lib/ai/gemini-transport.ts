import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { AiTransportError, type AiTransport, type TransportRequest, type TransportResponse } from "./types";

const BLOCK_FINISH_REASONS = new Set([
  "SAFETY",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
]);

/** Real Gemini transport. Only used outside automated tests (TESTING §1). */
export function geminiTransport(apiKey: string): AiTransport {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(req: TransportRequest): Promise<TransportResponse> {
      try {
        const res = await ai.models.generateContent({
          model: req.model,
          contents: req.prompt,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 1024,
            abortSignal: req.signal,
          },
        });
        const finish = res.candidates?.[0]?.finishReason;
        const blockReason =
          res.promptFeedback?.blockReason ?? (finish && BLOCK_FINISH_REASONS.has(finish) ? finish : undefined);
        return {
          text: res.text ?? "",
          inputTokens: res.usageMetadata?.promptTokenCount,
          outputTokens: res.usageMetadata?.candidatesTokenCount,
          blockReason: blockReason ? String(blockReason) : undefined,
        };
      } catch (err) {
        if (req.signal.aborted) throw err;
        if (err instanceof ApiError) throw new AiTransportError(err.status, `http_${err.status}`);
        throw new AiTransportError(undefined, "network");
      }
    },
  };
}
