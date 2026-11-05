# ROADMAP — urutan pengerjaan untuk Claude Code

Kerjakan berurutan. Setiap langkah selesai jika kriteria terpenuhi dan `lint`, `typecheck`, `test` lolos. Satu langkah = satu commit (atau PR kecil).

## Fase 0 · Fondasi (Minggu 9, awal)

| # | Langkah | Selesai jika |
|---|---|---|
| 0.1 | Inisialisasi Next.js 15 + TS strict + Tailwind + ESLint + Prettier + vitest | `npm run dev` jalan; CI hijau |
| 0.2 | `lib/env.ts` validasi env | App gagal start dengan pesan jelas bila env kurang |
| 0.3 | `lib/log` (logger, `withRequestLog`, `audit` stub) + middleware `requestId` + header keamanan | Setiap respons punya `x-request-id`; `headers.test.ts` lolos |
| 0.4 | Supabase lokal + migrasi `0001`–`0003` (skema, fungsi, RLS) | `rls.test.ts` dan `public-context.test.ts` lolos |
| 0.5 | `lib/privacy/redact.ts` + `scanPii` | `redact.test.ts` (≥ 40 kasus) lolos |
| 0.6 | ESLint rules: larang `console.log`, `dangerouslySetInnerHTML`, impor service role di jalur publik | Lint gagal bila dilanggar |

## Fase 1 · Chat publik (Minggu 9)

| # | Langkah | Selesai jika |
|---|---|---|
| 1.1 | `lib/ai/client.ts` (timeout, retry, fallback) + `withAiLogging` | Unit test dengan mock: timeout, 429, blocked, invalid output |
| 1.2 | Prompt chat publik + perakitan prompt dengan delimiter & escape | `prompt-assembly.test.ts` lolos |
| 1.3 | `lib/rate-limit` | `ratelimit.test.ts` lolos |
| 1.4 | `POST /api/chat/public` | Alur §5.1 ARCHITECTURE lengkap; `canary.test.ts` lolos |
| 1.5 | Halaman `/e/[slug]` sesuai INTERFACE §4.1 | E2E skenario 1–3 lolos |
| 1.6 | Seed 3 acara dummy (dokumen dari ChatGPT, langsung `approved`) | `supabase db reset` menghasilkan data demo |

## Fase 2 · Auth dan dokumen (Minggu 10)

| # | Langkah | Selesai jika |
|---|---|---|
| 2.1 | Login magic link, `/auth/callback`, `requireUser/Role/Membership` | `authz.test.ts` lolos |
| 2.2 | Super admin: buat & arsipkan kepanitiaan | Audit tercatat |
| 2.3 | Unggah dokumen: validasi file, storage privat, ekstraksi, PII scan | `upload.test.ts` lolos |
| 2.4 | Perapihan dengan `GEMINI_MODEL_REFINE` + validasi JSON | Status berpindah benar; `refine_failed` bisa di-retry |
| 2.5 | Halaman tinjau (diff asli vs hasil AI, edit, approve/reject) | Audit wajib; gagal audit = aksi batal |
| 2.6 | Visibilitas Publik/Internal + dialog konfirmasi | `visibility.test.ts` lolos |
| 2.7 | Kelola anggota (undang, ubah peran, hapus; admin terakhir tidak bisa dihapus) | Audit tercatat |
| 2.8 | QR code per acara | PNG/SVG terunduh dan mengarah ke `/e/[slug]` |

## Fase 3 · Mode Panitia (Minggu 10)

| # | Langkah | Selesai jika |
|---|---|---|
| 3.1 | `POST /api/chat/internal` + label "INTERNAL" | Anggota acara lain ditolak |
| 3.2 | Generator rundown (JSON tervalidasi) + tabel + Salin | E2E skenario 6 lolos |
| 3.3 | Generator checklist | Item terurut H-30 → H |

## Fase 4 · Observabilitas dan pengerasan (Minggu 11)

| # | Langkah | Selesai jika |
|---|---|---|
| 4.1 | `/admin/logs` (Audit, AI, Keamanan) + ekspor CSV | Data tampil dengan filter |
| 4.2 | Chat log teredaksi untuk admin kepanitiaan | Hanya acaranya sendiri |
| 4.3 | Cron retensi | `retention.purge.completed` tercatat |
| 4.4 | `logging.test.ts`, `csrf.test.ts`, `audit.test.ts` | Lolos |
| 4.5 | `/api/health` + halaman error dengan `requestId` | — |
| 4.6 | Evaluasi AI (`eval/`) | Hasil CSV untuk laporan |
| 4.7 | Checklist SECURITY §6 | Semua tercentang |

## Fase 5 · Finalisasi (Minggu 12)

- Deploy ke Vercel (production) + Supabase cloud; env production terisi; cron aktif.
- Video demo cadangan (antisipasi kuota habis saat presentasi).
- Screenshot untuk laporan memakai data dummy saja.

## Di luar MVP (jangan dikerjakan tanpa persetujuan)

Draf FAQ publik otomatis, draf anggaran, statistik pertanyaan, ekspor PDF, RAG, mode terang.
