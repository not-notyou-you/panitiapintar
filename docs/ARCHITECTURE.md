# ARCHITECTURE — PanitiaPintar

## 1. Gambaran sistem

```
                    ┌────────────────────────── Vercel (Next.js) ───────────────────────────┐
Pengunjung ──HTTPS─►│ middleware: requestId · security headers · session refresh            │
Panitia   ──HTTPS─►│                                                                        │
Admin     ──HTTPS─►│  app/ (UI)          app/api/* & server actions                         │
                    │                       │                                               │
                    │                       ├─ guard: zod · requireRole · rateLimit         │
                    │                       ├─ lib/privacy/redact ──────────────┐           │
                    │                       ├─ lib/context (ambil dokumen)      │           │
                    │                       └─ lib/ai (withAiLogging) ──────────┼──► Gemini API
                    │                                                           │   (REFINE / CHAT)
                    └───────────────────────────┬───────────────────────────────┘
                                                │ JWT pengguna (RLS)  /  service role (sistem saja)
                                                ▼
                            Supabase: Postgres + RLS · Auth · Storage (privat)
```

## 2. Komponen

| Komponen | Tanggung jawab |
|---|---|
| `middleware.ts` | Buat `requestId`, pasang header keamanan, refresh sesi Supabase, blokir `/panitia` & `/admin` tanpa sesi |
| `lib/auth` | `getSession()`, `requireUser()`, `requireRole()`, `requireMembership(committeeId, role?)` |
| `lib/privacy` | `scanPii()`, `redact()` (pola + label), `redactDeep()` untuk objek |
| `lib/documents` | Validasi file, ekstraksi teks, pipeline perapihan, approval, visibilitas |
| `lib/context` | Menyusun konteks per mode. **Publik** hanya via RPC `public_context(slug)`; **Internal** via query dengan JWT pengguna |
| `lib/ai` | Klien Gemini, prompt templates, timeout, retry, fallback, `withAiLogging()` |
| `lib/log` | `logger` (pino), `audit()`, `withRequestLog()` |
| `lib/rate-limit` | Rate limit berbasis Postgres (`rate_limit_hit()`) |
| `lib/env.ts` | Validasi env dengan zod saat boot; gagal cepat jika ada yang kurang |

## 3. Struktur folder

```
panitiapintar/
├── CLAUDE.md
├── README.md
├── docs/
├── middleware.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx                         # daftar acara aktif
│   ├── e/[slug]/page.tsx                # chat publik
│   ├── login/page.tsx
│   ├── auth/callback/route.ts
│   ├── panitia/
│   │   ├── page.tsx
│   │   └── [committeeId]/page.tsx       # tab: tanya | rundown | checklist
│   ├── admin/
│   │   ├── page.tsx                     # super admin: semua kepanitiaan
│   │   ├── new/page.tsx
│   │   ├── logs/page.tsx                # super admin: audit & AI logs
│   │   └── [committeeId]/
│   │       ├── page.tsx                 # tab: dokumen | anggota | pengaturan | QR
│   │       └── documents/[docId]/review/page.tsx
│   └── api/
│       ├── chat/public/route.ts
│       ├── chat/internal/route.ts
│       ├── generate/[kind]/route.ts     # kind: rundown | checklist
│       ├── documents/upload/route.ts
│       ├── documents/[id]/refine/route.ts
│       ├── qr/[slug]/route.ts
│       ├── cron/retention/route.ts
│       └── health/route.ts
├── components/
│   ├── ui/                              # Button, Badge, Dialog, Table …
│   ├── chat/                            # ChatWindow, ChatBubble, PrivacyBanner …
│   └── admin/                           # DocRow, VisibilitySelect, ReviewDiff …
├── lib/
│   ├── env.ts
│   ├── auth/
│   ├── privacy/
│   ├── documents/
│   ├── context/
│   ├── ai/
│   │   ├── client.ts
│   │   ├── prompts/{refine,chat-public,chat-internal,rundown,checklist}.ts
│   │   └── with-ai-logging.ts
│   ├── log/
│   ├── rate-limit/
│   └── supabase/{server,browser,service}.ts
├── supabase/
│   ├── migrations/
│   └── seed/                            # dokumen dummy 3 acara (dari ChatGPT)
└── tests/{unit,integration,security,e2e}/
```

## 4. Siklus hidup dokumen

```
 unggah ──► uploaded ──► (scan PII + redaksi) ──► refining ──► needs_review ──► approved
                │                                    │               │             │
                └─ gagal validasi: rejected          └─ AI gagal:    └─ admin      └─ admin ubah: kembali
                                                       refine_failed   tolak:         ke needs_review
                                                       (bisa retry)    rejected
```

- Kolom `status`: `uploaded | refining | refine_failed | needs_review | approved | rejected | archived`.
- Kolom `visibility`: `internal` (default) | `public`.
- **Chatbot hanya memakai dokumen `approved`.** Mode publik: `approved AND public`. Mode panitia: `approved` (publik + internal).
- File asli disimpan di bucket privat `documents-raw/{committee_id}/{doc_id}`; tidak pernah dikirim ke pengguna publik.
- Versi teks disimpan di `document_versions` (asli-teredaksi, hasil AI, hasil edit admin); `documents.current_version_id` menunjuk versi yang disetujui.

## 5. Alur request

### 5.1 Chat publik
1. Middleware: `requestId`, header.
2. Route: validasi body (`slug`, `message` ≤ 1.000 karakter, `history` ≤ 6 giliran).
3. `rateLimit("chat_public", ipHash)`: 10 req/menit, 100 req/hari per IP-hash.
4. Cek acara ada dan `status='active'`.
5. `redact(message)` dan `redact(history)`.
6. `public_context(slug)` (SECURITY DEFINER, hanya publik + approved).
7. Susun prompt dengan delimiter → Gemini `CHAT` (timeout 20 dtk, 1 retry, fallback model).
8. `redact(output)` sebagai pengaman keluaran.
9. Simpan `chat_logs` (teks teredaksi), `ai_calls` (metadata), log `chat.public.answered`.
10. Respons `{ answer, sources[], requestId }`.

### 5.2 Chat internal / generator
Sama dengan 5.1, tetapi langkah 3 memakai `userId`, langkah 4 diganti `requireMembership(committeeId)`, dan langkah 6 memakai query dengan JWT pengguna (RLS memastikan hanya kepanitiaan miliknya). Respons yang memakai dokumen internal diberi `containsInternal: true`.

### 5.3 Unggah dan perapihan
1. `requireMembership(committeeId, 'admin')`.
2. Validasi file: ekstensi + **magic bytes** + ukuran ≤ 10 MB + jumlah dokumen aktif ≤ 10.
3. Simpan ke bucket privat; buat baris `documents` (`uploaded`, `internal`).
4. Ekstraksi teks (timeout 30 dtk, maks. 200.000 karakter).
5. `scanPii()` → simpan ringkasan temuan (jenis + jumlah, **bukan nilainya**) → `redact()`.
6. Gemini `REFINE` → versi `ai_refined` → status `needs_review`.
7. Admin meninjau di `/review`, boleh mengedit → **Approve** (audit) atau **Reject** (audit).

## 6. Keandalan (robustness)

| Kegagalan | Penanganan |
|---|---|
| Gemini timeout / 5xx | 1 retry dengan backoff + jitter, lalu fallback ke `GEMINI_MODEL_FALLBACK`, lalu pesan ramah |
| Gemini 429 (kuota) | Tidak retry; kembalikan "Chatbot sedang ramai"; log `ai.call.rate_limited` |
| Respons AI diblokir safety filter | Pesan "Tidak dapat menjawab pertanyaan ini"; log `ai.call.blocked` |
| Respons AI kosong / format rusak (refine) | Status `refine_failed`, tombol coba lagi; log `document.refine.failed` |
| Ekstraksi file gagal / file terenkripsi | Status `rejected` dengan alasan; log `document.upload.rejected` |
| Supabase tidak tersedia | 503 + `requestId`; `/api/health` melaporkan `db: down` |
| Env tidak lengkap | Aplikasi gagal start dengan pesan jelas (`lib/env.ts`) |
| Dua admin approve bersamaan | Optimistic locking: kolom `version` di `documents`; konflik → 409 |
| Konteks terlalu panjang | Batas total konteks 400.000 karakter per acara; unggahan yang melebihi ditolak dengan pesan |

Setiap operasi I/O punya **timeout eksplisit**. Tidak ada `await` tanpa batas waktu ke layanan luar.

## 7. Pilihan desain dan alasannya

| Keputusan | Alasan |
|---|---|
| Tanpa RAG/vector DB | 3–5 dokumen per acara muat di konteks Gemini; lebih sederhana dan lebih mudah diaudit |
| Dua model Gemini | REFINE dipanggil jarang dan butuh ketelitian; CHAT dipanggil sering dan butuh kuota longgar |
| Rate limit di Postgres | Tidak menambah layanan luar; cukup untuk skala kampus |
| Filter publik di fungsi DB | Pengaman struktural; bug di JS tidak bisa membocorkan dokumen internal |
| Riwayat chat publik di browser | Server stateless untuk pengunjung; tidak ada profil pengguna anonim |
