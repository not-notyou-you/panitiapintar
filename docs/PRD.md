# PRD — PanitiaPintar

**Product Requirements Document**
Final Project AI706 · AI Software & Toolkits · Universitas Multimedia Nusantara
Versi 2.0 · 4 November 2026 · Status: Disetujui dosen, siap dikembangkan

Dokumen teknis: [ARCHITECTURE](./ARCHITECTURE.md) · [DATABASE](./DATABASE.md) · [SECURITY](./SECURITY.md) · [LOGGING](./LOGGING.md) · [API](./API.md) · [INTERFACE](./INTERFACE.md) · [TESTING](./TESTING.md) · [ROADMAP](./ROADMAP.md)

---

## 1. Ringkasan

PanitiaPintar adalah platform chatbot berbasis dokumen untuk kepanitiaan acara kampus. Platform ini punya dua mode:

1. **Mode Publik:** pengunjung awam bertanya tentang sebuah acara dan mendapat jawaban yang hanya bersumber dari dokumen yang sudah ditandai *publik* oleh panitia.
2. **Mode Panitia:** anggota panitia yang login memakai AI untuk merencanakan acara (rundown, checklist, timeline) dan bertanya tentang dokumen internal seperti anggaran dan notulensi rapat.

Platform menampung **banyak kepanitiaan** sekaligus. Super admin bisa menambah kepanitiaan baru, dan tiap kepanitiaan mengelola 3–5 dokumennya sendiri.

## 2. Latar belakang dan masalah

| Masalah | Dampak |
|---|---|
| Pertanyaan pengunjung berulang (lokasi, jadwal, dress code, cara daftar) | Panitia menghabiskan waktu membalas DM/WhatsApp yang isinya sama |
| Informasi tersebar di guidebook, rundown, dan postingan IG | Pengunjung awam sulit menemukan jawaban |
| Jawaban antarpanitia tidak konsisten, dan tidak ada yang membalas di luar jam aktif | Pengunjung bingung dan kecewa |
| Perencanaan acara dimulai dari nol setiap tahun | Pelajaran dari LPJ dan notulensi tahun lalu jarang dipakai ulang |

## 3. Tujuan

| ID | Tujuan | Indikator keberhasilan |
|---|---|---|
| G1 | Pengunjung mendapat jawaban akurat tanpa menunggu panitia | ≥ 85% jawaban benar pada bank 30 pertanyaan uji |
| G2 | Chatbot tidak mengarang informasi | ≤ 10% jawaban mengarang pada pertanyaan jebakan |
| G3 | Dokumen internal tidak pernah bocor ke publik | 0 kebocoran dari seluruh uji isolasi |
| G4 | Data pribadi tidak terkirim ke model AI | 100% pola data pribadi uji teredaksi sebelum dikirim ke Gemini |
| G5 | Panitia terbantu merencanakan acara | ≥ 4/5 skor kegunaan dari 5 panitia penguji |

## 4. Pengguna dan peran

| Peran | Siapa | Login | Hak akses |
|---|---|---|---|
| **Super admin** | Pengelola platform (tim proyek) | Ya | Menambah, mengarsipkan, dan menghapus kepanitiaan; menunjuk admin panitia |
| **Admin panitia** | Ketua atau sekretaris kepanitiaan | Ya | Mengunggah, mengedit, dan menghapus dokumen; **menentukan visibilitas publik/internal**; mengundang anggota |
| **Anggota panitia** | Seluruh panitia acara | Ya | Mode Panitia untuk kepanitiaannya sendiri; membaca semua dokumen kepanitiaannya |
| **Pengunjung** | Masyarakat umum, peserta, mahasiswa | Tidak | Chat publik satu acara; hanya dokumen publik |

Satu akun bisa menjadi anggota di lebih dari satu kepanitiaan dengan peran berbeda.

## 5. Visibilitas dokumen

Setiap dokumen **wajib** punya status visibilitas. Status ini **diputuskan oleh admin panitia**, bukan oleh sistem.

| Status | Dipakai oleh | Contoh umum |
|---|---|---|
| **Publik** | Mode Publik dan Mode Panitia | Guidebook peserta, rundown publik, FAQ, aturan lomba, info lokasi dan transportasi |
| **Internal** | Mode Panitia saja | Anggaran, notulensi rapat, LPJ tahun lalu, daftar kontak panitia, rundown teknis |

Aturan:
- **Default dokumen baru adalah Internal.** Admin harus secara sadar mengubahnya menjadi Publik (prinsip *secure by default*).
- Mengubah Internal menjadi Publik memunculkan dialog konfirmasi beserta hasil pemindaian data pribadi.
- Contoh di tabel hanya rekomendasi. Panitia bebas memutuskan, misalnya anggaran yang memang ingin dibuka untuk transparansi.

## 6. Ruang lingkup

### 6.1 MVP (wajib saat demo Minggu 13)

| ID | Fitur | Mode |
|---|---|---|
| F1 | Super admin menambah, mengedit, dan mengarsipkan kepanitiaan | Admin |
| F2 | Admin panitia mengunggah dokumen (PDF, DOCX, TXT, MD; 3–5 disarankan, maks. 10 aktif) | Admin |
| F3 | Admin panitia menandai dokumen Publik/Internal | Admin |
| F4 | Pemindaian dan redaksi data pribadi otomatis saat unggah | Admin |
| F4a | Perapihan dokumen otomatis oleh Gemini (model REFINE) di dalam aplikasi | Admin |
| F4b | Peninjauan hasil perapihan oleh admin (edit, approve, reject) sebelum dipakai chatbot | Admin |
| F5 | Halaman chat publik per acara (`/e/[slug]`) dan QR code-nya | Publik |
| F6 | Jawaban hanya dari dokumen publik acara tersebut, dengan sebutan sumber | Publik |
| F7 | Redaksi otomatis data pribadi pada pesan sebelum dikirim ke Gemini | Semua |
| F8 | Tanya-jawab atas seluruh dokumen kepanitiaan (publik + internal) | Panitia |
| F9 | Generator rundown dan checklist persiapan (H-30 sampai Hari H) | Panitia |
| F10 | Login panitia dan isolasi data antarkepanitiaan | Panitia |
| F10a | Audit log, AI call log, dan halaman log untuk super admin | Admin |

### 6.2 Tambahan (jika waktu cukup)

| ID | Fitur |
|---|---|
| F11 | Draf FAQ publik dari dokumen internal, diterbitkan setelah disetujui admin |
| F12 | Draf anggaran berdasarkan anggaran tahun lalu |
| F13 | Statistik pertanyaan pengunjung yang paling sering muncul (anonim) |
| F14 | Ekspor hasil rundown/checklist ke PDF atau Google Docs |

### 6.3 Di luar ruang lingkup

- Pendaftaran peserta, pembayaran, dan sertifikat
- Cek status pribadi pengunjung ("apakah saya sudah terdaftar?"); diarahkan ke narahubung resmi
- RAG/vector database (dicatat sebagai rencana pengembangan bila dokumen per acara membesar)
- Aplikasi mobile native

## 7. Kebutuhan fungsional rinci

### Mode Publik
- **FR-P1:** Pengunjung membuka `/e/[slug]` tanpa login.
- **FR-P2:** Halaman menampilkan nama acara, tanggal, peringatan privasi, dan 3–4 contoh pertanyaan.
- **FR-P3:** Server hanya memuat dokumen `approved` dengan `visibility = 'public'` milik acara tersebut, lewat fungsi DB `public_context()`. Filter ditegakkan di database, bukan di prompt.
- **FR-P4:** Jika jawaban tidak ada di dokumen, chatbot menjawab "Informasi ini belum tersedia" dan menampilkan narahubung resmi.
- **FR-P5:** Chatbot menolak meminta atau mengolah data pribadi, dan menolak pertanyaan status pribadi.
- **FR-P6:** Riwayat chat hanya disimpan di browser selama tab terbuka.

### Mode Panitia
- **FR-T1:** Panitia login dengan email; hanya melihat kepanitiaan tempat ia terdaftar.
- **FR-T2:** Panitia memilih mode kerja: *Tanya Dokumen*, *Buat Rundown*, atau *Buat Checklist*.
- **FR-T3:** Konteks yang dikirim ke Gemini berisi seluruh dokumen kepanitiaan tersebut (publik + internal), setelah redaksi.
- **FR-T4:** Hasil rundown/checklist tampil sebagai tabel yang bisa disalin.
- **FR-T5:** Setiap jawaban yang memakai dokumen internal diberi label "Internal: jangan dibagikan ke publik".

### Admin
- **FR-A1:** Super admin membuat kepanitiaan (nama, slug, tanggal acara, narahubung resmi).
- **FR-A2:** Admin panitia mengunggah dokumen; teks diekstrak, dipindai, dan diredaksi otomatis (NIM, NIK, nomor HP, email, rekening, NPWP).
- **FR-A3:** Teks teredaksi dirapikan otomatis oleh Gemini menjadi bagian per topik + draf FAQ.
- **FR-A3b:** Admin meninjau hasil perapihan berdampingan dengan teks asli, boleh mengedit, lalu *Approve* atau *Reject*. Hanya dokumen *approved* yang dipakai chatbot.
- **FR-A4:** Admin panitia mengubah visibilitas dokumen dengan konfirmasi.
- **FR-A5:** Admin panitia mengundang anggota lewat email.

## 8. Kebutuhan non-fungsional

| Kategori | Kebutuhan |
|---|---|
| Privasi | Lima lapis perlindungan (lihat §9); kunci API hanya di server; log teredaksi dihapus maks. 30 hari setelah acara |
| Keamanan | Row Level Security Supabase untuk semua tabel; peran dicek di server |
| Performa | Jawaban pertama < 8 detik pada koneksi kampus |
| Biaya | Rp0: Gemini API tier gratis, Supabase dan Vercel tier gratis |
| Aksesibilitas | Kontras teks ≥ 4.5:1; navigasi keyboard; nyaman di layar ponsel 360 px |
| Bahasa | Antarmuka dan jawaban dalam Bahasa Indonesia |

## 9. Privasi data: lima lapis

| Lapis | Mekanisme |
|---|---|
| 0. Sumber bersih | Checklist manual + pemindaian otomatis saat unggah; kontak pribadi diganti kontak resmi |
| 1. Peringatan di layar | Banner tetap "Jangan ketik data pribadi"; konfirmasi bila pesan berisi pola data pribadi |
| 2. Redaksi di server | Pola NIM, NIK, HP, email, rekening diganti label (`[NOMOR_HP]`) sebelum dikirim ke Gemini |
| 3. Batas ruang lingkup | System prompt melarang meminta data pribadi; pertanyaan status pribadi diarahkan ke narahubung |
| 4. Simpan minimal | Chat publik tanpa login dan stateless; log hanya teks teredaksi tanpa IP; dihapus setelah acara |

Catatan transparansi: tier gratis Gemini API dapat memakai prompt untuk pengembangan produk Google. Karena itu lapis 0–3 memastikan tidak ada data pribadi yang terkirim sejak awal. Untuk implementasi nyata direkomendasikan tier berbayar. Prinsip ini sejalan dengan minimisasi data pada UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi.

## 10. Peran tool AI

| Tool | Jenis | Kapan | Tugas |
|---|---|---|---|
| **Claude Code** | Non-Google | Pengembangan | Asisten coding: kode, migrasi, RLS, test. Setiap perubahan ditinjau tim |
| **ChatGPT** | Non-Google | Pengembangan | Membuat dokumen dummy 3 acara fiktif (termasuk data pribadi palsu) dan bank pertanyaan uji |
| **Gemini (model REFINE, keluarga Flash)** | Google | Di dalam aplikasi | Merapikan dokumen saat diunggah |
| **Gemini (model CHAT, keluarga Flash-Lite)** | Google | Di dalam aplikasi | Chatbot publik, Mode Panitia, generator rundown/checklist |

QR code dibuat langsung oleh aplikasi. Pengguna tidak perlu membuka situs AI mana pun.

## 11. Model data (ringkas)

```
committees(id, name, slug, event_date, location, contact_public, status)
memberships(user_id, committee_id, role['admin'|'member'])
documents(id, committee_id, title, visibility['internal'|'public'], status[uploaded…approved], pii_summary, current_version_id, version)
document_versions(id, document_id, kind['original_redacted'|'ai_refined'|'admin_edited'], content)
chat_logs(committee_id, mode, question_redacted, answered, source_doc_ids)   -- dihapus 30 hari setelah acara
audit_logs(...)  ai_calls(...)  rate_limits(...)                             -- lihat DATABASE.md & LOGGING.md
```

## 12. Evaluasi

| Uji | Metode | Target |
|---|---|---|
| Akurasi | 30 pertanyaan uji (draf ChatGPT, ditinjau tim), dinilai manual | ≥ 85% benar |
| Halusinasi | 10 pertanyaan jebakan di luar dokumen | ≤ 10% mengarang |
| Isolasi | 10 upaya membocorkan dokumen internal lewat chat publik (prompt injection) | 0 bocor |
| Lintas acara | Pertanyaan yang sama di dua acara berbeda | Jawaban sesuai acaranya masing-masing |
| Redaksi | 20 pesan berisi data pribadi **palsu** | 100% teredaksi |
| Kegunaan | 5–10 pengunjung + 5 panitia, kuesioner skala 1–5 | Rata-rata ≥ 4 |

## 13. Timeline

| Minggu | Target RPKPS | Keluaran |
|---|---|---|
| M8 | Problem & tool plan | PRD final, wawancara panitia, dokumen dummy 3 acara (ChatGPT) |
| M9 | Prototype | Skema Supabase + RLS, chat publik satu acara |
| M10 | Working demo | Multi-kepanitiaan, admin unggah dokumen, redaksi, Mode Panitia |
| M11 | Peer review | Seluruh uji §12, perbaikan |
| M12 | Finalisasi | Laporan ≥ 10 halaman, slide ≤ 15, video demo |
| M13 | Presentasi | Live demo di kelas |

## 14. Risiko

| Risiko | Mitigasi |
|---|---|
| Batas request tier gratis Gemini tercapai saat demo | Simpan cache jawaban contoh; siapkan video demo cadangan |
| Prompt injection membocorkan dokumen internal | Dokumen internal tidak pernah dimuat di mode publik (RLS) |
| Regex gagal mendeteksi nama orang | Diakui sebagai keterbatasan; ditutup lapis 1 dan 3 |
| Ruang lingkup terlalu besar untuk 6 minggu | Kunci MVP F1–F10; fitur F11+ hanya bila waktu cukup |
| Dokumen tidak diperbarui panitia | Tampilkan "terakhir diperbarui" di halaman acara |
