// API.md §1: uniform error body. Messages are Indonesian, generic, and safe to display.
export const ERROR_MESSAGES = {
  INVALID_INPUT: "Pertanyaan tidak valid. Periksa kembali isinya.",
  FORBIDDEN: "Permintaan ditolak.",
  NOT_FOUND: "Acara tidak ditemukan.",
  PAYLOAD_TOO_LARGE: "Pesan terlalu panjang.",
  RATE_LIMITED: "Chatbot sedang ramai. Coba lagi dalam 1 menit.",
  AI_UNAVAILABLE: "Chatbot sedang tidak tersedia. Coba lagi sebentar lagi.",
  SERVICE_UNAVAILABLE: "Layanan sedang tidak tersedia. Coba lagi nanti.",
  INTERNAL: "Terjadi kesalahan. Coba lagi nanti.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; requestId: string };
}

export function errorBody(code: ErrorCode, requestId: string): ApiErrorBody {
  return { error: { code, message: ERROR_MESSAGES[code], requestId } };
}
