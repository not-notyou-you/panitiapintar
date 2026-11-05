// Human labels for PII counts (INTERFACE §4.5, §4.7). Counts only; values are never stored.
const NAMES: Record<string, string> = {
  phone: "nomor HP",
  email: "email",
  nik: "NIK",
  nim: "NIM",
  npwp: "NPWP",
  account: "nomor rekening",
};

export function piiTotal(summary: Record<string, number> | null | undefined): number {
  return Object.values(summary ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function describePii(summary: Record<string, number> | null | undefined): string[] {
  return Object.entries(summary ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${n} ${NAMES[k] ?? k}`);
}

export const REJECT_REASON_LABELS: Record<string, string> = {
  tidak_akurat: "Ringkasan tidak akurat",
  tidak_relevan: "Dokumen tidak relevan",
  data_pribadi: "Berisi data pribadi",
  duplikat: "Duplikat",
  lainnya: "Lainnya",
};

export const STATUS_REASON_LABELS: Record<string, string> = {
  ai_unavailable: "Layanan AI sedang tidak tersedia.",
  ai_invalid_output: "Hasil AI tidak sesuai format.",
  timeout: "Perapihan terlalu lama dan dihentikan.",
  internal: "Terjadi kesalahan sistem.",
  ...REJECT_REASON_LABELS,
};
