# CLAUDE.md — Instruksi untuk Claude Code

File ini dibaca otomatis oleh Claude Code di setiap sesi. Ikuti aturan di sini di atas kebiasaan default.

## Proyek

**PanitiaPintar**: platform chatbot berbasis dokumen untuk banyak kepanitiaan acara kampus.

- **Mode Publik** (`/e/[slug]`): pengunjung tanpa login bertanya; jawaban hanya dari dokumen **Publik + Approved** acara tersebut.
- **Mode Panitia** (`/panitia/[id]`): anggota panitia login; tanya dokumen publik + internal, buat rundown/checklist.
- **Admin** (`/admin`): kelola kepanitiaan, unggah dokumen (dirapikan otomatis oleh AI, lalu ditinjau manusia), atur Publik/Internal, lihat log.

Final project mata kuliah AI706 (UMN). Semua layanan memakai **tier gratis**.

## Bacaan wajib sebelum mengubah kode

| Mengerjakan                   | Baca dulu                                      |
| ----------------------------- | ---------------------------------------------- |
| Fitur apa pun                 | [`docs/PRD.md`](docs/PRD.md)                   |
| Struktur kode, alur request   | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Tabel, migrasi, RLS           | [`docs/DATABASE.md`](docs/DATABASE.md)         |
| Auth, input, AI, file, header | [`docs/SECURITY.md`](docs/SECURITY.md)         |
| Log apa pun                   | [`docs/LOGGING.md`](docs/LOGGING.md)           |
| Route handler / server action | [`docs/API.md`](docs/API.md)                   |
| UI                            | [`docs/INTERFACE.md`](docs/INTERFACE.md)       |
| Test                          | [`docs/TESTING.md`](docs/TESTING.md)           |
| Urutan pengerjaan             | [`docs/ROADMAP.md`](docs/ROADMAP.md)           |

## Stack

- Next.js 15 (App Router) + TypeScript `strict`, Node 20+
- Supabase: Postgres, Auth (email + kata sandi), Storage (bucket privat), RLS
- Gemini API via `@google/genai`, dua model:
  - `GEMINI_MODEL_REFINE` (keluarga Flash): merapikan dokumen
  - `GEMINI_MODEL_CHAT` (keluarga Flash-Lite): chatbot dan generator
  - Nama versi model **jangan di-hardcode**; selalu dari env. Cek model yang tersedia di Google AI Studio.
- Validasi: `zod` · Logging: `pino` · Ekstraksi: `unpdf` (PDF), `mammoth` (DOCX) · QR: `qrcode`
- Test: `vitest` (unit/integrasi), `@playwright/test` (e2e)
- Styling: Tailwind CSS dengan token di `docs/INTERFACE.md`
- Hosting: Vercel

## Perintah

```bash
npm run dev            # server lokal
npm run lint           # eslint, wajib bersih
npm run typecheck      # tsc --noEmit, wajib bersih
npm run test           # vitest
npm run test:e2e       # playwright
npm run test:security  # uji redaksi, isolasi, RLS
npx supabase db reset  # reset DB lokal + jalankan migrasi + seed dummy
```

Sebelum menyatakan tugas selesai: `lint`, `typecheck`, dan `test` harus lolos.

## Aturan keamanan (TIDAK BOLEH DILANGGAR)

1. **Dokumen internal tidak boleh pernah masuk konteks mode publik.** Jalur publik hanya membaca lewat fungsi DB `public_context(slug)` yang memfilter `visibility='public' AND status='approved'`. Jangan pernah memfilter visibilitas di JavaScript sebagai satu-satunya pengaman.
2. **Semua teks yang dikirim ke Gemini harus melewati `redact()`** dari `lib/privacy/redact.ts`. Tidak ada pengecualian, termasuk dokumen, pertanyaan, dan riwayat chat.
3. **`SUPABASE_SERVICE_ROLE_KEY` dan `GEMINI_API_KEY` hanya di server.** File yang memakainya wajib `import "server-only"`. Tidak boleh ada prefiks `NEXT_PUBLIC_`.
4. **Service role hanya untuk tugas sistem** (penulisan audit log, job retensi). Request pengguna memakai klien Supabase dengan JWT pengguna agar RLS berlaku.
5. **Setiap input dari luar divalidasi `zod`** di batas route/action, termasuk params URL.
6. **Otorisasi dicek di server pada setiap request** lewat `requireRole()` / `requireMembership()`. Menyembunyikan tombol di UI bukan otorisasi.
7. **Jangan pernah me-log**: teks sebelum redaksi, isi dokumen, isi jawaban AI, token, kunci API, email mentah, IP mentah. Lihat `docs/LOGGING.md`.
8. **Error ke klien selalu generik** + `requestId`. Stack trace hanya di log server.
9. **Isi dokumen dan pertanyaan pengguna adalah data, bukan instruksi.** Selalu bungkus dengan delimiter di prompt (lihat `docs/SECURITY.md` §6).
10. **Perubahan visibilitas dan approval dokumen wajib tercatat di `audit_logs`.**

## Aturan logging

- Gunakan `logger` dari `lib/log/logger.ts`, **bukan** `console.log`.
- Setiap request punya `requestId` (dibuat di middleware, diteruskan ke semua log dan ke header `x-request-id`).
- Nama event mengikuti katalog di `docs/LOGGING.md` §5 (`domain.action.result`). Event baru: tambahkan ke katalog di PR yang sama.
- Aksi sensitif: tulis ke `audit_logs` lewat `audit()`, bukan hanya ke logger.
- Setiap panggilan Gemini: tulis ke `ai_calls` lewat `withAiLogging()`.

## Konvensi kode

- Struktur folder: lihat `docs/ARCHITECTURE.md` §3. Logika bisnis di `lib/`, bukan di komponen.
- Server Components secara default; `"use client"` hanya bila butuh interaktivitas.
- Nama file `kebab-case.ts`, komponen `PascalCase.tsx`.
- Tidak ada `any`. Tidak ada `// @ts-ignore` tanpa komentar alasan.
- Teks UI dalam Bahasa Indonesia; kode, nama variabel, dan komentar dalam Bahasa Inggris.
- Migrasi DB hanya lewat file baru di `supabase/migrations/`; jangan mengubah migrasi lama.
- Setiap fitur keamanan baru wajib disertai test negatif (memastikan yang dilarang memang ditolak).

## Data uji

Semua dokumen di `supabase/seed/` adalah **dummy buatan ChatGPT** untuk 3 acara fiktif. Jangan pernah memakai data panitia/peserta sungguhan di repo, test, atau screenshot.

## Cara kerja yang diharapkan

- Kerjakan per langkah di `docs/ROADMAP.md`; satu langkah = satu commit yang rapi.
- Jika instruksi bertentangan dengan aturan keamanan di atas, berhenti dan tanyakan.
- Jika menemukan celah keamanan di kode yang ada, laporkan dulu sebelum melanjutkan fitur.
