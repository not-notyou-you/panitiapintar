# INTERFACE — PanitiaPintar

Spesifikasi antarmuka: sistem visual, peta halaman, wireframe, komponen, dan perilaku tiap state.
Dokumen terkait: [PRD](./PRD.md) · [API](./API.md) · [SECURITY](./SECURITY.md)

---

## 1. Prinsip desain

1. **Pengunjung awam dulu.** Mode Publik harus bisa dipakai tanpa penjelasan, di ponsel, sambil berdiri di lokasi acara.
2. **Status data selalu terlihat.** Setiap dokumen dan setiap jawaban menunjukkan apakah ia *Publik* atau *Internal*.
3. **Jujur soal AI.** Pengguna selalu tahu bahwa yang menjawab adalah AI, dari dokumen apa, dan kapan dokumen itu terakhir diperbarui.
4. **Retro, tegas, dan datar.** Sudut tajam, garis tepi tebal, bayangan keras, warna solid.

## 2. Sistem visual: "Retro Window"

Gaya jendela desktop era 90-an berbasis piksel: panel abu terang, garis tepi hitam tebal, bayangan keras, dan title bar berwarna. Warna utama **biru navy `#005795`**. Contoh hidup: [`ui-preview.html`](./ui-preview.html).

### Warna

| Token | Hex | Pemakaian |
|---|---|---|
| `--bg` | `#E4E4E4` | Latar halaman (70% atas) |
| `--floor` | `#C9C9C9` | Latar "lantai" (30% bawah) |
| `--card` | `#F2F2F2` | Isi jendela, kartu |
| `--card-hi` | `#FAFAFA` | Sorotan bevel kiri-atas, bubble bot, baris genap |
| `--card-lo` | `#C4C4C4` | Bayangan bevel kanan-bawah |
| `--line` | `#2B2B2B` | Semua garis tepi, bayangan keras, header tabel |
| `--tx` | `#2B2B2B` | Teks utama |
| `--mut` | `#5F5F5F` | Label, keterangan, timestamp |
| `--acc` | `#005795` | **Navy utama**: title bar, tombol utama, bubble pengguna, tab aktif, badge PUBLIK |
| `--acc-dk` | `#003A63` | Bevel gelap tombol navy |
| `--acc-lt` | `#3D82B8` | Bevel terang tombol navy |
| `--acc-tint` | `#DCE8F2` | Latar banner info, hover chip, badge PERLU DITINJAU |
| `--on-acc` | `#F2F2F2` | Teks di atas navy (kontras ±6.9:1) |
| `--internal` | `#2B2B2B` | Badge INTERNAL (teks `--card`) |
| `--warn` / `--warn-bg` | `#A11D2B` / `#F6DFE2` | Peringatan data pribadi, status gagal, hapus |

Merah hanya untuk peringatan dan error, tidak pernah sebagai warna dekoratif.

### Bentuk dan kedalaman

- **`border-radius: 0` di semua elemen.** Tidak ada lingkaran; penanda status memakai kotak, ikon dekoratif memakai belah ketupat.
- **Jendela** (`.win`): border 4 px `--line` + bevel `inset -4px -4px 0 --card-lo, inset 4px 4px 0 --card-hi` + bayangan keras `6px 6px 0 --line`.
- **Title bar**: tinggi 28 px, latar `--acc`, garis bawah 4 px, teks kapital, tombol `x` kotak di kanan (dekoratif, `aria-hidden`; bila berfungsi wajib punya label).
- **Tombol utama**: latar `--acc`, border 4 px, bevel navy; saat ditekan bevel dibalik (efek tertekan).
- **Input**: border 3 px, bevel ke dalam (`inset 3px 3px 0 --card-lo`).
- **Tanpa gradasi halus, blur, atau glow.** Satu-satunya "gradasi" adalah pemisah keras latar 70/30.
- Dekorasi latar: siluet gunung piksel navy di lantai (opasitas 45%, `z-index:-1`), boleh diganti siluet gedung kampus.

### Tipografi

| Peran | Font | Ukuran |
|---|---|---|
| Judul halaman, title bar, tombol, tab, badge, label | **Pixelify Sans** | 11–20 px, sering kapital |
| Isi chat, isi dokumen, tabel, input | **IBM Plex Mono** | 13–14 px |
| Angka metrik | Pixelify Sans | 26 px |

Font piksel hanya untuk elemen pendek. Teks panjang (jawaban chatbot, dokumen) memakai IBM Plex Mono agar tetap nyaman dibaca. Keduanya dari Google Fonts.

### Animasi

- Hanya animasi bertahap (`steps()`): indikator status berkedip, tiga kotak "mengetik".
- Hormati `prefers-reduced-motion`: semua animasi dimatikan.

### Spasi dan grid

- Skala 4 px: 4, 8, 12, 16, 24. Jarak antarjendela 22–24 px.
- Margin samping 16 px di ponsel, 28 px di desktop; lebar maks. 1180 px.
- Desktop: chat publik 380 px di kiri, area kerja di kanan. Di bawah 900 px semua jendela ditumpuk satu kolom.

## 3. Peta halaman

| Rute | Akses | Isi |
|---|---|---|
| `/` | Publik | Landing page: navigasi lengket (Acara · Cara kerja · Privasi · Masuk panitia), hero + contoh percakapan, kartu acara aktif (maks. 6, `?semua=1` untuk semua), 3 langkah cara kerja, privasi dan data, bagian untuk panitia, footer. Latar 70/30 dan gunung piksel dimatikan; bagian dipisah pita `--card` bergaris 4 px. Kartu acara = tautan (border + bayangan keras); blok informasi tanpa border |
| `/e/[slug]` | Publik | Chat publik satu acara |
| `/login` | Publik | Login panitia (magic link email) |
| `/panitia` | Panitia | Daftar kepanitiaan milik pengguna |
| `/panitia/[id]` | Anggota kepanitiaan | Ruang kerja: Tanya Dokumen · Rundown · Checklist |
| `/admin` | Super admin | Daftar semua kepanitiaan |
| `/admin/new` | Super admin | Formulir kepanitiaan baru |
| `/admin/[id]` | Admin panitia | Tab Dokumen · Anggota · QR Code · Chat Log · Pengaturan |
| `/admin/[id]/documents/[docId]/review` | Admin panitia | Tinjau hasil perapihan AI: bandingkan, edit, approve/reject |
| `/admin/logs` | Super admin | Tab Audit · AI · Keamanan |

## 4. Wireframe

### 4.1 Chat publik `/e/[slug]` (ponsel)

```
┌──────────────────────────────────┐
│ ◆ PanitiaPintar                  │
│ ISFEST UMN 2026                  │
│ 14–15 Nov 2026 · Lecture Hall C  │
├──────────────────────────────────┤
│ ▌Jangan ketik data pribadi.      │  ← banner tetap, tidak bisa ditutup
│ ▌Dijawab oleh AI (Gemini) dari   │
│ ▌dokumen resmi panitia.          │
├──────────────────────────────────┤
│ Coba tanyakan:                   │
│ [Jam berapa acara mulai?]        │  ← chip contoh pertanyaan
│ [Di mana lokasinya?]             │
│ [Apa dress code-nya?]            │
│                                  │
│          ┌──────────────────────┐│
│          │Parkir motor di mana? ││  ← bubble pengguna (navy)
│          └──────────────────────┘│
│ ┌────────────────────────────┐   │
│ │Parkir motor tersedia di    │   │  ← bubble bot (surface)
│ │basement Gedung B.          │   │
│ │SUMBER  Guidebook · hal. 4  │   │
│ └────────────────────────────┘   │
├──────────────────────────────────┤
│ [Tulis pertanyaan…        ] [▶]  │
│ Dokumen diperbarui 10 Nov 2026   │
│ Narahubung: @isfestumn           │
└──────────────────────────────────┘
```

### 4.2 Ruang kerja panitia `/panitia/[id]` (desktop)

```
┌──────────────┬──────────────────────────────────────────────┐
│ ◆ PanitiaPintar│ ISFEST UMN 2026            [Mode Panitia]  │
│              ├──────────────────────────────────────────────┤
│ KEPANITIAAN  │ [Tanya Dokumen] [Buat Rundown] [Checklist]   │  ← tab
│ ■ ISFEST 2026│──────────────────────────────────────────────│
│ □ DISCO XIII │                                              │
│              │  Berapa sisa anggaran divisi acara?          │
│ DOKUMEN      │                                              │
│ PUB Guidebook│  ┌──────────────────────────────────────┐    │
│ PUB Rundown  │  │ INTERNAL · jangan dibagikan ke publik │    │
│ INT Anggaran │  │ Berdasarkan anggaran per 1 Nov, sisa  │    │
│ INT Notulen 3│  │ divisi acara Rp2.150.000 …            │    │
│              │  │ SUMBER  Anggaran · Notulensi rapat 3  │    │
│              │  └──────────────────────────────────────┘    │
│              │                                              │
│              │ [Tulis pertanyaan atau instruksi…      ] [▶] │
└──────────────┴──────────────────────────────────────────────┘
```

### 4.3 Buat Rundown

```
┌─────────────────────────────────────────────────────────┐
│ Tanggal acara  [14 Nov 2026]   Mulai [09.00] Selesai [16.00]│
│ Isi acara      [Seminar, lomba UI/UX, awarding        ] │
│ Catatan        [Ada ishoma 1 jam                     ] │
│                                     [Buat draf rundown] │
├──────────┬──────────┬─────────────────────┬─────────────┤
│ Waktu    │ Durasi   │ Kegiatan            │ PIC divisi  │
│ 08.00    │ 60'      │ Registrasi ulang    │ Acara       │
│ 09.00    │ 15'      │ Opening             │ MC          │
│ …        │          │                     │             │
├──────────┴──────────┴─────────────────────┴─────────────┤
│ DRAF AI · periksa sebelum dipakai     [Salin] [Ulangi]  │
└─────────────────────────────────────────────────────────┘
```

### 4.4 Kelola dokumen `/admin/[id]` tab Dokumen

```
┌──────────────────────────────────────────────────────────────┐
│ ISFEST UMN 2026 · Dokumen (4/5)              [+ Unggah dokumen]│
├────────────────────┬────────────┬──────────────┬─────────────┤
│ Judul              │ Visibilitas│ Data pribadi │ Diperbarui  │
├────────────────────┼────────────┼──────────────┼─────────────┤
│ Guidebook peserta  │ [PUBLIK ▾] │ ■ Bersih     │ 10 Nov      │
│ Rundown publik     │ [PUBLIK ▾] │ ■ Bersih     │ 10 Nov      │
│ Anggaran v3        │ [INTERNAL▾]│ ■ 2 temuan   │ 01 Nov      │  ← merah
│ Notulensi rapat 3  │ [INTERNAL▾]│ ■ Bersih     │ 28 Okt      │
└────────────────────┴────────────┴──────────────┴─────────────┘
```

### 4.5 Dialog ubah ke Publik

```
┌──────────────────────────────────────────┐
│ Jadikan "Anggaran v3" PUBLIK?            │
│                                          │
│ Dokumen ini akan bisa dibaca chatbot     │
│ publik dan dijawab ke siapa saja.        │
│                                          │
│ ■ 2 pola data pribadi ditemukan:         │
│   · 1 nomor HP   · 1 nomor rekening      │
│                                          │
│ [Batal]  [Redaksi lalu jadikan Publik]   │
└──────────────────────────────────────────┘
```

Tombol "Jadikan Publik tanpa redaksi" tidak disediakan selama masih ada temuan.

### 4.6 Status dokumen di tabel

| Status | Badge | Aksi tersedia |
|---|---|---|
| `refining` | `SEDANG DIRAPIKAN` (garis, animasi kotak) | — |
| `refine_failed` | `GAGAL` (merah) | Coba lagi · Hapus |
| `needs_review` | `PERLU DITINJAU` (latar --acc-tint) | Tinjau |
| `approved` | `DISETUJUI` | Ubah visibilitas · Edit (kembali ke tinjau) |
| `rejected` | `DITOLAK` | Unggah ulang · Hapus |

Hanya dokumen `DISETUJUI` yang dipakai chatbot. Dropdown visibilitas nonaktif untuk status lain, dengan tooltip "Setujui dokumen dulu".

### 4.7 Tinjau hasil perapihan `/admin/[id]/documents/[docId]/review`

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← Dokumen   Tinjau: Guidebook peserta          [PERLU DITINJAU]          │
├──────────────────────────────────┬───────────────────────────────────────┤
│ TEKS ASLI (sudah diredaksi)      │ HASIL PERAPIHAN AI           [Edit]   │
│                                  │                                       │
│ …Hubungi [NOMOR_HP] untuk info…  │ ## Lokasi                             │
│                                  │ Lecture Hall Gedung C, lantai 2.      │
│ ■ Disensor otomatis:             │ ## Jadwal                             │
│   1 nomor HP · 1 email           │ Registrasi 08.00, opening 09.00.      │
│                                  │ ## FAQ (8)                            │
│                                  │ T: Apakah ada parkir motor? …         │
├──────────────────────────────────┴───────────────────────────────────────┤
│ ▌AI bisa salah merangkum. Periksa angka, tanggal, dan lokasi.            │
│                                     [Tolak]   [Setujui]                  │
└──────────────────────────────────────────────────────────────────────────┘
```

- Dua kolom di desktop; di ponsel menjadi tab "Asli" / "Hasil AI".
- Bagian yang berbeda angka/tanggal antara asli dan hasil AI diberi penanda kotak kuning di margin.
- Mode Edit: editor Markdown polos (textarea monospace); simpan sebagai versi `admin_edited`.
- **Setujui** membuka konfirmasi singkat: "Dokumen ini akan dipakai chatbot sebagai INTERNAL. Ubah ke Publik bisa dilakukan setelahnya."
- Jika `refine_failed`: panel kanan menampilkan alasan + tombol "Coba rapikan lagi".

### 4.8 Tab QR Code

```
┌──────────────────────────────────────────────┐
│ ┌──────────┐  panitiapintar.app/e/isfest-2026 │
│ │ ▓▓ ▓ ▓▓▓ │  [Salin link]                    │
│ │ ▓ ▓▓ ▓ ▓ │                                  │
│ │ ▓▓▓ ▓ ▓▓ │  [Unduh PNG 1024] [Unduh SVG]    │
│ └──────────┘                                  │
│ Tempel di poster, standee, atau caption IG.   │
└──────────────────────────────────────────────┘
```

### 4.9 Log super admin `/admin/logs`

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Log   [Audit] [AI] [Keamanan]          Rentang [7 hari ▾]  Acara [Semua ▾] │
├──────────────┬──────────────┬──────────────────────┬──────────┬───────────┤
│ Waktu        │ Aktor        │ Aksi                 │ Hasil    │ Request   │
│ 20/11 10.14  │ Admin ISFEST │ document.visibility… │ SUCCESS  │ req_01JD… │
│ 20/11 10.02  │ (anonim)     │ auth.access_denied   │ DENIED   │ req_01JC… │
└──────────────┴──────────────┴──────────────────────┴──────────┴───────────┘
                                                          [Ekspor CSV]
```

- Tab **AI**: tiga kartu angka (panggilan hari ini, rata-rata latensi, % error/fallback) + grafik batang per jam, warna navy solid.
- Klik baris membuka panel samping berisi `metadata` JSON (tanpa data pribadi) dan tombol salin `requestId`.
- Hasil `DENIED`/`FAILURE` memakai badge merah; `SUCCESS` badge garis.
- Filter dan panel detail memakai parameter URL (`?tab=&range=&committee=&action=&outcome=&detail=`), jadi bisa dibagikan dan tetap jalan tanpa JavaScript. Tab Keamanan: audit `denied` + `security.canary_leaked` (7 hari) dan jendela rate limit yang terlampaui (2 hari).

### 4.10 Halaman error

```
┌────────────────────────────────────┐
│ ◆ Terjadi kesalahan                │
│ Coba lagi beberapa saat lagi.      │
│ Kode: req_01JD3Q8Z7K2M  [Salin]    │
│ [Kembali]                          │
└────────────────────────────────────┘
```
`app/error.tsx` membaca `requestId` dari `<meta name="request-id">` yang ditulis root layout; `not-found.tsx` membacanya dari header. `global-error.tsx` (layout ikut gagal) hanya punya `digest` Next.js.

## 5. Komponen

| Komponen | Varian / state | Catatan |
|---|---|---|
| `Button` | primary (navy), ghost (abu), danger; default, hover, pressed, focus, disabled, loading | Border 4 px + bevel; pressed = bevel terbalik; fokus = garis 3 px navy + offset 2 px |
| `Badge` | `PUBLIK` (navy), `INTERNAL` (hitam), `DRAF AI` (garis), status dokumen | Pixelify Sans 11 px kapital, border 2 px |
| `Window` | default, dengan tab | Title bar navy + tombol x; wadah utama semua panel |
| `ChatBubble` | user (navy, bevel), bot (abu terang, bayangan keras), bot-internal, bot-error | Bot menampilkan baris `SUMBER` |
| `SuggestionChip` | default, hover | Mengirim pertanyaan saat diklik |
| `PrivacyBanner` | publik, internal | Tidak bisa ditutup di mode publik |
| `PiiWarning` | inline (input chat), panel (unggah) | Menyebut jenis temuan, tidak menampilkan nilainya |
| `DocRow` | bersih, ada temuan, sedang dipindai | |
| `VisibilitySelect` | publik, internal | Ubah ke publik selalu lewat dialog |
| `CommitteeSwitcher` | sidebar desktop, dropdown ponsel | Hanya kepanitiaan milik pengguna |
| `ResultTable` | rundown, checklist | Tombol Salin, Ulangi |
| `EmptyState` | tidak ada dokumen, tidak ada acara | Ikon belah ketupat + satu ajakan tindakan |
| `DocStatusBadge` | 5 status di §4.6 | |
| `ReviewPane` | asli, hasil AI, edit | Penanda perbedaan angka/tanggal |
| `QrPanel` | — | Unduh PNG/SVG, salin link |
| `LogTable` | audit, ai, keamanan | Panel detail + salin requestId |
| `ErrorState` | — | Selalu tampilkan `requestId` |

## 6. State dan pesan

| Situasi | Tampilan |
|---|---|
| Menunggu jawaban | Bubble bot berisi tiga kotak kecil berkedip bergantian |
| Info tidak ada di dokumen | "Informasi ini belum tersedia di dokumen panitia. Hubungi narahubung: @isfestumn" |
| Pesan berisi pola data pribadi | Di atas input: "Pesanmu sepertinya berisi nomor HP. Hapus dulu?" [Hapus] [Kirim tetap]; bila tetap dikirim, server meredaksi |
| Pertanyaan status pribadi | "Untuk status pendaftaran, pembayaran, atau sertifikat, hubungi narahubung resmi panitia." |
| Batas request Gemini tercapai | "Chatbot sedang ramai. Coba lagi dalam 1 menit." |
| Acara diarsipkan | Halaman `/e/[slug]` menampilkan "Acara ini sudah selesai" tanpa input chat |
| Akses ditolak | "Kamu bukan anggota kepanitiaan ini." + tombol kembali |

## 7. Aksesibilitas

- Kontras teks normal ≥ 4.5:1: `#2B2B2B` di atas `#F2F2F2`, `#F2F2F2` di atas navy `#005795`, dan `#5F5F5F` di atas `#F2F2F2` semuanya lolos.
- Fokus keyboard: garis 3 px navy + offset 2 px, tidak boleh dihilangkan.
- Semua kontrol bisa dijangkau dengan keyboard; urutan fokus mengikuti urutan visual.
- Daftar pesan memakai `role="log"` dan `aria-live="polite"` agar jawaban baru dibacakan pembaca layar.
- Badge tidak hanya mengandalkan warna: selalu berisi teks `PUBLIK` / `INTERNAL`.
- Target sentuh minimal 44 × 44 px di ponsel.

## 8. Mikrocopy

| Tempat | Teks |
|---|---|
| Banner publik | "Jangan ketik data pribadi. Dijawab oleh AI (Gemini) dari dokumen resmi panitia." |
| Banner panitia | "Mode Panitia: jawaban dapat memuat dokumen internal. Jangan teruskan ke publik." |
| Label jawaban internal | "INTERNAL · jangan dibagikan ke publik" |
| Label hasil generator | "DRAF AI · periksa sebelum dipakai" |
| Placeholder input publik | "Tulis pertanyaan tentang acara ini…" |
| Placeholder input panitia | "Tanya dokumen atau beri instruksi…" |
