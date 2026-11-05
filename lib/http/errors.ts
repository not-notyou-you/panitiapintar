// API.md §1: uniform error body. Messages are Indonesian, generic, and safe to display.
export const ERROR_MESSAGES = {
  INVALID_INPUT: "Pertanyaan tidak valid. Periksa kembali isinya.",
  UNAUTHENTICATED: "Silakan masuk terlebih dahulu.",
  FORBIDDEN: "Permintaan ditolak.",
  NOT_FOUND: "Acara tidak ditemukan.",
  CONFLICT: "Data sudah berubah. Muat ulang halaman lalu coba lagi.",
  PAYLOAD_TOO_LARGE: "Pesan terlalu panjang.",
  UNSUPPORTED_FILE: "Tipe file tidak didukung. Gunakan PDF, DOCX, TXT, atau MD.",
  UNPROCESSABLE: "File tidak dapat diproses.",
  RATE_LIMITED: "Chatbot sedang ramai. Coba lagi dalam 1 menit.",
  AI_UNAVAILABLE: "Chatbot sedang tidak tersedia. Coba lagi sebentar lagi.",
  SERVICE_UNAVAILABLE: "Layanan sedang tidak tersedia. Coba lagi nanti.",
  INTERNAL: "Terjadi kesalahan. Coba lagi nanti.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; requestId: string };
}

/** `message` overrides the default text; it must be a fixed, generic string (never interpolated data). */
export function errorBody(code: ErrorCode, requestId: string, message?: string): ApiErrorBody {
  return { error: { code, message: message ?? ERROR_MESSAGES[code], requestId } };
}

/** Thrown inside handlers/actions to end with a specific error; mapped once at the boundary. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly userMessage?: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}
