# PROMPTS: 4 sesi pengembangan dengan Claude Code

Satu tahap = satu percakapan baru di Claude Code, dibuka di root folder proyek. Salin prompt apa adanya.
Tahap berikutnya baru dimulai setelah tahap sebelumnya lolos `lint`, `typecheck`, dan test, lalu di-commit.

---

## Tahap 1: Fondasi dan keamanan inti

```
Kamu akan membangun PanitiaPintar dari nol. Ini tahap 1 dari 4.

Sebelum menulis kode, baca seluruhnya: CLAUDE.md, docs/PRD.md, docs/ARCHITECTURE.md, docs/DATABASE.md,
docs/SECURITY.md, docs/LOGGING.md, docs/TESTING.md, docs/ROADMAP.md. Lalu buat rencana singkat dan tunggu persetujuanku.

Lingkup tahap ini = ROADMAP Fase 0 (langkah 0.1–0.6):
1. Inisialisasi Next.js 15 (App Router, TypeScript strict), Tailwind, ESLint, Prettier, vitest; struktur folder sesuai ARCHITECTURE §3.
2. lib/env.ts: validasi semua env di .env.example dengan zod; gagal start dengan pesan jelas; rahasia hanya di server ("server-only").
3. lib/log: logger pino (redact paths + hook redaksi string, LOGGING §3), withRequestLog(), audit() (service role, LOGGING §7),
   middleware.ts: requestId (req_ + ULID) di header x-request-id, header keamanan SECURITY SEC-09, refresh sesi Supabase.
4. Supabase lokal + migrasi 0001_init, 0002_functions, 0003_rls persis seperti DATABASE.md (termasuk trigger append-only
   dan purge_expired_logs). Jangan sederhanakan RLS.
5. lib/privacy: redact(), redactDeep(), scanPii() sesuai SEC-05 (normalisasi NFKC, full-width digit, zero-width char;
   urutan pola spesifik → umum; tidak pernah mengembalikan nilai asli).
6. Aturan ESLint: larang console.log, dangerouslySetInnerHTML, dan impor klien service role dari app/e/** dan app/api/chat/public/**.
7. Script npm: dev, lint, typecheck, test, test:security, test:e2e (placeholder).
8. GitHub Actions CI sesuai TESTING §5.

Test wajib lolos di tahap ini: redact.test.ts (≥ 40 kasus termasuk negatif: tanggal, jam, "Rp150.000"),
rls.test.ts, public-context.test.ts, headers.test.ts, logging.test.ts (versi awal untuk logger).

Aturan:
- Ikuti CLAUDE.md "Aturan keamanan" tanpa pengecualian.
- Belum ada UI selain halaman placeholder dan /api/health.
- Jangan memanggil Gemini sungguhan di test.
- Commit per langkah ROADMAP dengan pesan yang jelas.

Selesai jika: npm run lint, typecheck, test, test:security lolos; supabase db reset berhasil.
Akhiri dengan ringkasan: apa yang dibuat, hasil test, keputusan yang menyimpang dari docs (jika ada) beserta alasannya,
dan hal yang perlu aku siapkan untuk tahap 2.
```

---

## Tahap 2: Chat publik end-to-end

**Siapkan dulu:** dokumen dummy 3 acara fiktif dari ChatGPT (lihat bagian "Prompt ChatGPT" di bawah), simpan sebagai file `.md` di `supabase/seed/docs/<slug>/`.

```
Ini tahap 2 dari 4 PanitiaPintar. Tahap 1 (fondasi, migrasi, RLS, redaksi, logging) sudah selesai dan di-commit.

Baca ulang: CLAUDE.md, docs/ARCHITECTURE.md §5.1 dan §6, docs/API.md (chat publik + kontrak prompt), docs/SECURITY.md
(SEC-01, 02, 05, 06, 07, 09), docs/LOGGING.md §5 bagian Chat dan AI, docs/INTERFACE.md (§2 sistem visual, §4.1, §6–8),
dan buka docs/ui-preview.html sebagai acuan visual utama. Buat rencana dulu, tunggu persetujuanku.

Lingkup = ROADMAP Fase 1:
1. lib/ai/client.ts: @google/genai, model dari env (GEMINI_MODEL_CHAT, GEMINI_MODEL_REFINE, GEMINI_MODEL_FALLBACK),
   timeout 20 dtk, 1 retry dengan backoff+jitter untuk timeout/5xx, tanpa retry untuk 429, fallback model, pemetaan
   status (ok/timeout/rate_limited/blocked/error/invalid_output). withAiLogging() menulis ai_calls + event ai.call.*.
2. lib/ai/prompts/chat-public.ts persis seperti API.md §3; perakitan prompt dengan delimiter <documents>/<user_question>,
   escape < dan >, keluaran JSON divalidasi zod, NOT_FOUND → answered=false + kontak resmi.
3. lib/rate-limit memakai RPC rate_limit_hit(); bucket sesuai SEC-07; respons 429 + Retry-After.
4. POST /api/chat/public mengikuti 10 langkah ARCHITECTURE §5.1, termasuk redaksi input, riwayat, DAN output,
   serta deteksi kanari (SEC-02). Konteks HANYA dari RPC public_context(slug).
5. Seed: 3 acara fiktif dari supabase/seed/docs/, akun @contoh.test, dokumen langsung approved; setiap dokumen internal
   diberi string kanari unik CANARY-INT-xxxx. Simpan chat_logs teredaksi.
6. Halaman / (daftar acara aktif) dan /e/[slug] dengan gaya "Retro Window" navy dari INTERFACE §2: jendela bertitle bar,
   banner privasi, chip contoh pertanyaan, bubble, indikator mengetik, peringatan PII sebelum kirim, sumber jawaban,
   status kosong/arsip/rate limit/error dengan requestId. Riwayat chat hanya di state browser. Mobile-first 360 px.
   Font: Pixelify Sans (UI) + IBM Plex Mono (isi) via next/font.

Test wajib: prompt-assembly.test.ts, canary.test.ts, ratelimit.test.ts, unit lib/ai (mock: timeout, 429, blocked,
invalid output, fallback), dan e2e Playwright skenario 1–3 TESTING §3 (AI di-mock).

Aturan: Gemini sungguhan hanya untuk uji manual lokal, bukan di test otomatis. Render jawaban sebagai teks/Markdown
terbatas tanpa HTML mentah.

Selesai jika: semua test lolos; aku bisa membuka /e/<slug>, bertanya, dan melihat jawaban bersumber; pertanyaan tentang
anggaran dijawab "belum tersedia"; log menunjukkan requestId yang sama di log aplikasi, ai_calls, dan chat_logs.
Akhiri dengan ringkasan dan cara mencoba manual.
```

---

## Tahap 3: Auth, unggah, perapihan AI, tinjau, dan visibilitas

```
Ini tahap 3 dari 4 PanitiaPintar. Tahap 1–2 sudah selesai (fondasi + chat publik end-to-end).

Baca ulang: CLAUDE.md, docs/PRD.md §5–7, docs/ARCHITECTURE.md §4 dan §5.3, docs/DATABASE.md §3–5, docs/API.md
(upload, status, refine, server actions admin, QR, kontrak prompt refine), docs/SECURITY.md (SEC-03, 04, 08, 10, 11, 13),
docs/LOGGING.md §5–6 (Auth, Dokumen, Kepanitiaan, audit), docs/INTERFACE.md §3, §4.4–4.8, §5. Rencana dulu, tunggu persetujuanku.

Lingkup = ROADMAP Fase 2:
1. Login magic link Supabase, /auth/callback, logout; requireUser(), requireRole('super_admin'),
   requireMembership(committeeId, role?) dipanggil di setiap route/action; middleware memblokir /panitia dan /admin tanpa sesi.
   Cek Origin untuk semua mutasi (SEC-11).
2. Super admin: buat, edit, arsipkan kepanitiaan (/admin, /admin/new).
3. Unggah dokumen: validasi ekstensi + MIME + magic bytes, ≤10 MB, tolak PDF terenkripsi, DOCX bermakro, zip bomb,
   duplikat (sha256), kuota 10 dokumen; simpan di bucket privat dengan nama UUID; ekstraksi (unpdf, mammoth) dengan timeout;
   scanPii (simpan jumlah saja) → redact → versi original_redacted. Default visibility internal.
4. Perapihan: GEMINI_MODEL_REFINE, prompt refine.ts, keluaran JSON divalidasi zod → versi ai_refined → needs_review;
   gagal → refine_failed dengan tombol coba lagi; polling status.
5. Halaman tinjau (INTERFACE §4.7): asli vs hasil AI berdampingan, penanda perbedaan angka/tanggal, edit Markdown
   (redaksi ulang, versi admin_edited), Approve/Reject dengan optimistic locking. Gagal menulis audit = aksi dibatalkan.
6. Visibilitas lewat RPC set_document_visibility + dialog konfirmasi (INTERFACE §4.5); tolak publik bila belum approved
   atau pii_summary versi terkini tidak kosong. Edit setelah approved → kembali needs_review.
7. Kelola anggota: undang via email, ubah peran, hapus; admin terakhir tidak boleh dihapus. Email tidak pernah dicatat mentah.
8. Tab QR Code: GET /api/qr/[slug] PNG/SVG + salin link.
9. Semua aksi di atas menulis audit_logs dan event log sesuai katalog.

Test wajib: authz.test.ts (matriks anon/member/admin lain/admin/super admin untuk SETIAP route & action), upload.test.ts,
visibility.test.ts, csrf.test.ts, audit.test.ts, unit pipeline dokumen (mock Gemini), e2e skenario 4–5 TESTING §3.

Selesai jika: semua test lolos; alur unggah → dirapikan → ditinjau → approve → publik berjalan di lokal dan langsung
terjawab di /e/<slug>; anggota acara lain tidak bisa mengakses apa pun milik acara ini.
Akhiri dengan ringkasan, daftar endpoint/action beserta guard-nya, dan temuan keamanan bila ada.
```

---

## Tahap 4: Mode Panitia, observabilitas, pengerasan, dan siap demo

```
Ini tahap 4 dari 4 PanitiaPintar. Tahap 1–3 sudah selesai.

Baca ulang: CLAUDE.md, docs/ARCHITECTURE.md §5.2 dan §6, docs/API.md (chat internal, generate, cron, health),
docs/LOGGING.md (seluruhnya), docs/SECURITY.md §6 checklist, docs/TESTING.md §3–5, docs/INTERFACE.md §4.2, §4.3, §4.9, §4.10.
Rencana dulu, tunggu persetujuanku.

Lingkup = ROADMAP Fase 3, 4, dan 5:
A. Mode Panitia (/panitia, /panitia/[committeeId]):
   1. Pemilih kepanitiaan (hanya miliknya), tab Tanya Dokumen / Buat Rundown / Buat Checklist.
   2. POST /api/chat/internal: konteks approved (publik + internal) via JWT pengguna (RLS), redaksi penuh,
      label "INTERNAL · jangan dibagikan ke publik" bila memakai dokumen internal.
   3. POST /api/generate/rundown dan /checklist: keluaran JSON tervalidasi zod, tabel + Salin + Ulangi, label "DRAF AI".
B. Observabilitas:
   4. /admin/logs (super admin): tab Audit, AI (kartu angka + grafik per jam, warna navy solid), Keamanan; filter;
      panel detail; ekspor CSV. Tab Chat Log per kepanitiaan untuk admin (pertanyaan teredaksi yang tidak terjawab).
   5. GET /api/cron/retention (CRON_SECRET) memanggil purge_expired_logs(30, 90, 180) + vercel.json cron harian.
   6. /api/health; halaman error global dan not-found bergaya Retro Window yang menampilkan requestId.
C. Pengerasan:
   7. Audit ulang SELURUH kode terhadap SECURITY SEC-01..13 dan CLAUDE.md; laporkan temuan dalam tabel lalu perbaiki.
   8. Lengkapi logging.test.ts untuk alur chat internal, generator, dan unggah: tidak ada PII palsu, email, IP mentah,
      atau isi dokumen di output logger.
   9. Pastikan setiap event yang dipakai kode ada di katalog LOGGING §5–6 dan sebaliknya; perbarui docs bila perlu.
D. Evaluasi dan demo:
   10. Folder eval/: run-eval.ts membaca eval/questions.json, memanggil endpoint lokal dengan jeda antarpermintaan,
       menyimpan eval/results/<tanggal>.csv (pertanyaan, kategori, jawaban, sumber, answered, latency, requestId).
   11. README: langkah deploy ke Vercel + Supabase cloud, daftar env production, cara rotasi kunci.
   12. Jalankan dan centang checklist SECURITY §6 yang bisa diverifikasi otomatis; tandai yang perlu dicek manual.

Test wajib: semua test sebelumnya + e2e skenario 6–7 TESTING §3 + test authz untuk route baru. CI harus hijau.

Selesai jika: demo lengkap bisa dijalankan di lokal dengan 3 acara dummy (publik, panitia, admin, log);
npm run lint, typecheck, test, test:security, test:e2e lolos.
Akhiri dengan: ringkasan, hasil checklist SECURITY §6, daftar keterbatasan yang diketahui (untuk bab refleksi laporan),
dan skrip demo 10 menit langkah demi langkah.
```

---

## Prompt ChatGPT: dokumen dummy (sebelum Tahap 2)

```
Buat dokumen dummy untuk 3 acara kampus FIKTIF di universitas fiktif "Universitas Contoh Nusantara":
1. festival-teknologi-fiktif: festival teknologi 2 hari
2. lomba-desain-fiktif: lomba desain UI/UX
3. seminar-karier-fiktif: seminar karier 1 hari

Untuk SETIAP acara buat 5 dokumen Markdown terpisah, masing-masing 400–900 kata, Bahasa Indonesia:
- guidebook.md (publik): deskripsi, tanggal, lokasi gedung/ruang, cara daftar, dress code, aturan, parkir, transportasi, kontak resmi (akun IG fiktif)
- rundown-publik.md (publik): tabel jadwal per jam
- faq.md (publik): 15 tanya-jawab
- anggaran.md (internal): tabel pemasukan & pengeluaran per divisi dalam Rupiah, total, catatan
- notulensi-rapat.md (internal): notulensi 3 rapat persiapan dengan keputusan dan tindak lanjut per divisi

Aturan:
- Semua nama orang, nomor, dan akun FIKTIF.
- Di anggaran.md dan notulensi-rapat.md SENGAJA sisipkan data pribadi palsu untuk uji sensor: 2 nomor HP format 0812-0000-xxxx,
  1 email @contoh.test, 1 NIM format 0000099xxxx, 1 nomor rekening 10 digit diawali 000.
- Dokumen publik TIDAK boleh berisi data pribadi.
- Buat juga beberapa fakta yang hanya ada di dokumen internal (misalnya total anggaran) agar bisa diuji tidak bocor ke publik.
Tampilkan setiap file dalam blok kode terpisah dengan nama filenya.
```
