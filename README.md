# PanitiaPintar

Platform chatbot berbasis dokumen untuk banyak kepanitiaan acara kampus.

- **Mode Publik:** pengunjung memindai QR, lalu bertanya tanpa login. Jawaban hanya dari dokumen yang panitia tandai _Publik_ dan sudah disetujui.
- **Mode Panitia:** panitia login untuk bertanya tentang dokumen internal (anggaran, notulensi) dan membuat draf rundown serta checklist.
- **Admin:** unggah dokumen, yang dirapikan otomatis oleh AI lalu **ditinjau manusia** sebelum dipakai.

> Final Project AI706 · AI Software & Toolkits · Universitas Multimedia Nusantara · 2026/2027

## Dokumentasi

| Dokumen                                      | Isi                                                                |
| -------------------------------------------- | ------------------------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)                       | Instruksi dan aturan wajib untuk Claude Code                       |
| [docs/PRD.md](docs/PRD.md)                   | Kebutuhan produk, ruang lingkup, target evaluasi                   |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Komponen, struktur folder, alur request, siklus dokumen, keandalan |
| [docs/DATABASE.md](docs/DATABASE.md)         | Skema, fungsi, Row Level Security, retensi                         |
| [docs/SECURITY.md](docs/SECURITY.md)         | Model ancaman dan kontrol SEC-01…SEC-13                            |
| [docs/LOGGING.md](docs/LOGGING.md)           | Jenis log, format, katalog event dan audit, retensi                |
| [docs/API.md](docs/API.md)                   | Kontrak endpoint, kode error, kontrak prompt                       |
| [docs/INTERFACE.md](docs/INTERFACE.md)       | Sistem visual, peta halaman, wireframe, komponen                   |
| [docs/TESTING.md](docs/TESTING.md)           | Strategi test, test keamanan wajib, evaluasi AI                    |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Urutan pengerjaan per fase                                         |
| [docs/PROMPTS.md](docs/PROMPTS.md)           | Prompt 4 tahap untuk Claude Code + prompt dokumen dummy ChatGPT    |
| [docs/ui-preview.html](docs/ui-preview.html) | Acuan visual "Retro Window" navy                                   |

## Tool AI

| Tool                            | Kapan        | Tugas                                              |
| ------------------------------- | ------------ | -------------------------------------------------- |
| Claude Code                     | Pengembangan | Asisten coding                                     |
| ChatGPT                         | Pengembangan | Dokumen dummy 3 acara fiktif + bank pertanyaan uji |
| Gemini, model REFINE (Flash)    | Di aplikasi  | Merapikan dokumen saat diunggah                    |
| Gemini, model CHAT (Flash-Lite) | Di aplikasi  | Chatbot dan generator rundown/checklist            |

## Teknologi

Next.js 15 (App Router, TypeScript) · Supabase (Postgres, Auth, Storage, RLS) · Gemini API (`@google/genai`) · zod · pino · Tailwind CSS · vitest · Playwright · Vercel

## Menjalankan secara lokal (dari nol)

Panduan ini untuk laptop yang belum terpasang apa pun. Perkiraan waktu: 30–45 menit, sebagian besar menunggu unduhan Docker.

### 1. Pasang perangkat

| Perangkat                                                         | Versi                  | Catatan                                                                           |
| ----------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| [Git](https://git-scm.com/downloads)                              | terbaru                | Windows: pakai Git Bash untuk perintah di bawah                                   |
| [Node.js](https://nodejs.org/)                                    | 20 LTS atau lebih baru | Cek: `node -v`                                                                    |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | terbaru                | Windows: aktifkan WSL 2 saat instalasi. Untuk menjalankan database Supabase lokal |
| Editor                                                            | —                      | Disarankan VS Code + ekstensi ESLint dan Tailwind CSS                             |

Supabase CLI **tidak perlu dipasang terpisah**: sudah ikut sebagai dev dependency dan dipanggil lewat `npx supabase`.

Setelah memasang Docker Desktop, buka aplikasinya dan tunggu sampai statusnya _Engine running_. Supaya tidak lupa setelah restart: Settings → General → centang _Start Docker Desktop when you sign in_.

### 2. Ambil kode dan pasang dependensi

```bash
git clone <repo-url> panitiapintar
cd panitiapintar
npm ci                                  # pasang dependensi persis sesuai package-lock.json
git config core.hooksPath .githooks     # sekali per clone: pemindai rahasia sebelum commit
```

### 3. Nyalakan Supabase lokal

```bash
npx supabase start      # pertama kali mengunduh image ±2–3 GB, beberapa menit
npx supabase db reset   # buat tabel + isi 3 acara dummy dan 5 akun uji
npx supabase status     # tampilkan URL dan kunci untuk langkah 4
```

Dari `supabase status`, catat **API URL** (`http://127.0.0.1:54321`), **anon key**, dan **service_role key**. Supabase Studio (lihat isi database lewat browser) ada di `http://127.0.0.1:54323`.

### 4. Isi `.env.local`

```bash
cp .env.example .env.local
```

Isi seperti ini untuk lokal:

```dotenv
APP_URL=http://localhost:3000
APP_ENV=development

NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key dari supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key dari supabase status>

# Tanpa kunci Gemini: AI_MOCK=true dan GEMINI_API_KEY diisi apa saja (mis. mock).
# Dengan kunci asli (gratis di https://aistudio.google.com/apikey): AI_MOCK=false.
GEMINI_API_KEY=mock
GEMINI_MODEL_REFINE=gemini-3.6-flash
GEMINI_MODEL_CHAT=gemini-3.1-flash-lite
AI_MOCK=true

IP_HASH_SALT=<acak, min. 32 karakter>
CRON_SECRET=<acak, min. 16 karakter>
LOG_LEVEL=debug
TURNSTILE_ENABLED=false
```

Membuat nilai acak: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. File `.env.local` **jangan di-commit** dan kuncinya jangan dikirim ke grup chat.

Aplikasi memeriksa semua variabel saat start; jika ada yang kurang atau salah, pesan error menyebut nama variabelnya.

### 5. Jalankan

```bash
npm run dev     # http://localhost:3000
```

Cek cepat:

- `http://localhost:3000` menampilkan 3 acara fiktif.
- `http://localhost:3000/api/health` membalas `"status":"ok"`.
- `http://localhost:3000/login`: klik salah satu akun uji, lalu **Masuk**.

Akun seed (email `@contoh.test`) masuk dengan email + kata sandi `panitia-uji-2026` (hanya untuk seed lokal; daftarnya juga tampil di `/login` di luar produksi):

| Akun                                                                                 | Peran                                          |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `superadmin@contoh.test`                                                             | Super admin (`/admin`, `/admin/logs`)          |
| `admin.festek@contoh.test` · `admin.lomba@contoh.test` · `admin.seminar@contoh.test` | Admin satu acara                               |
| `anggota.festek@contoh.test`                                                         | Anggota Festival Teknologi Fiktif (`/panitia`) |

### 6. Jalankan test (sebelum push)

```bash
npx playwright install chromium   # sekali saja, untuk test e2e
npm run lint && npm run typecheck
npm run test                      # unit, tanpa database
npm run test:security             # butuh Supabase lokal menyala
npm run test:e2e                  # menyalakan server sendiri di port 3100 (AI_MOCK)
```

Test security dan e2e membuat acara/akun uji di database. Bersihkan lagi dengan `npx supabase db reset`.

### Sehari-hari

```bash
# buka Docker Desktop dulu
npx supabase start
npm run dev
```

Selesai bekerja: `npx supabase stop` (data tetap tersimpan).

### Masalah yang sering terjadi

| Gejala                                                       | Penyebab dan solusi                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Beranda kosong / "tidak ada acara"                           | Supabase belum menyala atau database belum diisi: buka Docker Desktop, `npx supabase start`, lalu `npx supabase db reset` |
| `supabase start` error `Cannot connect to the Docker daemon` | Docker Desktop belum dibuka / masih loading                                                                               |
| Port 54321/54322 sudah dipakai                               | Proyek Supabase lain masih jalan: jalankan `npx supabase stop` di folder proyek tersebut                                  |
| Error `Invalid environment` saat `npm run dev`               | Ada variabel `.env.local` yang kosong atau terlalu pendek; baca nama variabel di pesan error                              |
| Login "Email atau kata sandi salah" untuk akun uji           | Seed belum masuk: `npx supabase db reset`                                                                                 |
| "Terlalu banyak percobaan masuk"                             | Batas 5 kali/jam. Di lokal: `npx supabase db reset`                                                                       |
| Chatbot menjawab aneh/seragam                                | `AI_MOCK=true` memang jawaban tiruan. Pakai kunci Gemini asli untuk jawaban sungguhan                                     |
| Lint gagal karena folder `.next-*`                           | Hapus folder build lama (`.next-e2e`, `.next-eval`)                                                                       |

### Variabel lingkungan

| Variabel                                     | Wajib | Keterangan                                                            |
| -------------------------------------------- | ----- | --------------------------------------------------------------------- |
| `APP_URL`                                    | Ya    | URL publik aplikasi; dipakai untuk QR dan cek `Origin`                |
| `APP_ENV`                                    | Ya    | `development` / `preview` / `production`                              |
| `NEXT_PUBLIC_SUPABASE_URL`                   | Ya    | URL proyek Supabase                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`              | Ya    | Anon key (aman di browser, dibatasi RLS)                              |
| `SUPABASE_SERVICE_ROLE_KEY`                  | Ya    | **Server saja.** Untuk audit log dan job sistem                       |
| `GEMINI_API_KEY`                             | Ya    | **Server saja.** Dari Google AI Studio                                |
| `GEMINI_MODEL_REFINE`                        | Ya    | Model keluarga Flash untuk perapihan                                  |
| `GEMINI_MODEL_CHAT`                          | Ya    | Model keluarga Flash-Lite untuk chatbot                               |
| `GEMINI_MODEL_FALLBACK`                      | Ya    | Model cadangan bila model utama gagal                                 |
| `IP_HASH_SALT`                               | Ya    | String acak ≥ 32 karakter; kunci turunan berganti otomatis tiap bulan |
| `CRON_SECRET`                                | Ya    | Proteksi endpoint retensi                                             |
| `LOG_LEVEL`                                  | Tidak | Default `info` (production), `debug` (development)                    |
| `TURNSTILE_ENABLED` / `TURNSTILE_SECRET_KEY` | Tidak | Anti-bot opsional untuk chat publik                                   |
| `AI_MOCK`                                    | Tidak | `true` = Gemini tiruan (e2e/dev); wajib `false` di production         |

Aplikasi menolak start jika variabel wajib kosong. Jangan pernah commit `.env*`.

## Perintah

```bash
npm run lint && npm run typecheck   # wajib bersih
npm run test                        # unit
npm run test:security               # RLS, redaksi, isolasi, authz, logging
npm run test:e2e                    # Playwright
npm run eval -- --slug festival-teknologi-fiktif   # evaluasi AI ke server lokal (memakai kuota Gemini)
npm run check:secrets               # pindai rahasia di semua file yang di-track
```

## Deploy ke Vercel + Supabase cloud

1. **Supabase cloud** (tier gratis): buat proyek, region Singapura. Lalu dari mesin lokal:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push            # menjalankan supabase/migrations/0001…0006, TANPA seed
   ```
   Seed dummy hanya untuk lokal. Untuk demo di cloud, buat acara lewat `/admin/new` (atau jalankan `supabase/seed.sql` sekali lewat SQL Editor bila memang ingin data dummy). Bucket `documents-raw` dibuat oleh migrasi `0005`.
2. **Auth**: Authentication → URL Configuration: _Site URL_ = `APP_URL`; Matikan _Enable sign ups_ (akun hanya dibuat admin lewat menu Anggota, dengan kata sandi sementara). Login memakai email + kata sandi, jadi tidak butuh SMTP.
3. **Super admin pertama**: undang akun tim lewat Authentication → Users → _Invite_, lalu di SQL Editor: `update profiles set is_super_admin = true where user_id = '<uuid>';`. Hanya akun tim proyek (SECURITY §6).
4. **Vercel**: impor repo, framework Next.js, Node 20+. Isi env **Production** (dan Preview dengan proyek Supabase/kunci terpisah bila ada):

   | Variabel                                                              | Nilai production                                                                 |
   | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
   | `APP_URL`                                                             | `https://<domain>.vercel.app` (tanpa garis miring akhir)                         |
   | `APP_ENV`                                                             | `production`                                                                     |
   | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`          | Settings → API proyek Supabase                                                   |
   | `SUPABASE_SERVICE_ROLE_KEY`                                           | Settings → API → `service_role` (**jangan** diberi prefiks `NEXT_PUBLIC_`)       |
   | `GEMINI_API_KEY`                                                      | Google AI Studio, dibatasi ke Generative Language API                            |
   | `GEMINI_MODEL_REFINE` / `GEMINI_MODEL_CHAT` / `GEMINI_MODEL_FALLBACK` | Nama model terbaru keluarga Flash / Flash-Lite (cek AI Studio)                   |
   | `IP_HASH_SALT`                                                        | `openssl rand -hex 32`                                                           |
   | `CRON_SECRET`                                                         | `openssl rand -hex 32` (Vercel Cron mengirimnya sebagai `Authorization: Bearer`) |
   | `LOG_LEVEL`                                                           | `info`                                                                           |
   | `AI_MOCK`                                                             | `false`                                                                          |
   | `TURNSTILE_ENABLED`                                                   | `false` (atau `true` + `TURNSTILE_SECRET_KEY`)                                   |

5. **Deploy**, lalu periksa:
   - `GET /api/health` → `{"status":"ok","db":"up","ai":"configured"}` (503 = ada yang belum benar).
   - Vercel → Settings → Cron Jobs: `/api/cron/retention` terdaftar (`vercel.json`, harian 19.00 UTC = 02.00 WIB). Klik _Run_ sekali, lalu cari `retention.purge.completed` di Vercel Logs dan audit `system.retention_purge` di `/admin/logs`.
   - Header keamanan di securityheaders.com (target A).

## Rotasi kunci

Wajib bila ada dugaan bocor, dan setiap akhir semester (SECURITY SEC-10):

1. Buat kunci baru: Google AI Studio (`GEMINI_API_KEY`), Supabase → Settings → API → _Roll_ (`service_role`/anon), atau `openssl rand -hex 32` (`CRON_SECRET`, `IP_HASH_SALT`).
2. Ganti nilainya di Vercel → Settings → Environment Variables, lalu **Redeploy** (env baru hanya terbaca setelah deploy ulang).
3. Cabut kunci lama di penyedianya.
4. Catat di audit log (nama variabel saja, tanpa nilai), dengan `.env.local` sementara berisi URL + service role proyek production:
   ```bash
   npm run audit:key-rotated -- GEMINI_API_KEY
   ```

Catatan: mengganti `IP_HASH_SALT` memutus kaitan hash IP lama (memang tujuannya) dan mereset hitungan rate limit. Mengganti anon key mengharuskan redeploy karena nilainya ikut di bundle browser.

## Keamanan dan privasi, ringkasnya

- Dokumen internal **tidak pernah** dimuat untuk mode publik: filter di fungsi database, bukan di prompt.
- Data pribadi (NIM, NIK, HP, email, rekening, NPWP) diredaksi **sebelum** dikirim ke Gemini dan dicek lagi pada keluaran.
- Dokumen baru selalu Internal; hanya dokumen yang disetujui admin yang bisa dijadikan Publik.
- Setiap tindakan sensitif tercatat di audit log yang tidak bisa diubah; setiap panggilan AI tercatat metadatanya.
- Log tidak pernah menyimpan isi pesan mentah, isi dokumen, email, atau IP mentah.
- Tier gratis Gemini dapat memakai prompt untuk pengembangan produk Google. Karena itu demo hanya memakai **data dummy**, dan untuk penggunaan nyata disarankan tier berbayar.

Lihat [docs/SECURITY.md](docs/SECURITY.md) untuk prosedur rotasi kunci dan penanganan insiden.

## Tim

Kelompok ___ · Dosen pengampu: Sirojul Alam, S.Kom., M.Tr.Han

| Nama | Prodi | Peran |
| ---- | ----- | ----- |
|      |       |       |
