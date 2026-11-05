# TESTING — PanitiaPintar

## 1. Lapisan test

| Lapisan | Tool | Lokasi | Kapan jalan |
|---|---|---|---|
| Unit | vitest | `tests/unit/` | Setiap commit (CI) |
| Integrasi (DB lokal) | vitest + Supabase lokal | `tests/integration/` | Setiap PR |
| Keamanan | vitest + Supabase lokal | `tests/security/` | Setiap PR, wajib 100% lolos |
| E2E | Playwright | `tests/e2e/` | Sebelum demo |
| Evaluasi AI | skrip + Gemini sungguhan | `eval/` | Manual, Minggu 11 |

Test unit dan keamanan **tidak memanggil Gemini sungguhan**; gunakan mock `lib/ai/client.ts`.

## 2. Test keamanan wajib

| Test | Kontrol | Skenario |
|---|---|---|
| `rls.test.ts` | SEC-01, SEC-03 | Sebagai `anon`: select `documents` → 0 baris. Anggota A: baca dokumen B → 0 baris. Member: update visibilitas → ditolak. |
| `harden.test.ts` | SEC-04, SEC-13 | Migrasi 0004: `UPDATE` langsung kolom terlindungi sebagai admin → `42501`; insert `approved` → ditolak; approve dengan `version_id` dokumen lain → `invalid_version`; `expected_version` basi → `40001`; `audit_logs.request_id` terisi; `anon`/`authenticated` tanpa grant tidak bisa `execute`; `anon` select `committees.created_by` → ditolak |
| `documents_guard.test.sql` | SEC-04 | pgTAP (`npx supabase test db`): trigger tetap menolak walau grant kolom terlanjur dilebarkan |
| `public-context.test.ts` | SEC-01 | `public_context(slug)` tidak pernah mengembalikan dokumen `internal` atau non-`approved`, termasuk dari acara diarsipkan |
| `redact.test.ts` | SEC-05 | ≥ 40 kasus: berbagai format HP (`0812…`, `+62 812-…`, `62812…`), NIK, NIM, email, rekening dengan spasi, digit full-width, zero-width char; plus kasus negatif (tanggal, jam, harga "Rp150.000" tidak teredaksi) |
| `prompt-assembly.test.ts` | SEC-05, SEC-06 | Snapshot prompt final tidak berisi PII palsu; tag `</documents>` di isi dokumen ter-escape |
| `canary.test.ts` | SEC-02 | Mock AI mengembalikan string kanari → respons publik diganti pesan generik + event `security.canary.leaked` |
| `authz.test.ts` | SEC-03 | Setiap route/action dipanggil sebagai anon, member, admin lain, admin benar, super admin; matriks hasil sesuai |
| `upload.test.ts` | SEC-08 | PDF palsu (ekstensi .pdf isi PNG), DOCX bermakro, zip bomb, PDF terenkripsi, file 11 MB → semua ditolak dengan kode benar |
| `visibility.test.ts` | SEC-04 | Ubah ke publik saat `needs_review` → ditolak; saat `pii_summary` tidak kosong → ditolak; konflik versi → 409 |
| `ratelimit.test.ts` | SEC-07 | Request ke-11 dalam 1 menit → 429 + `Retry-After` |
| `csrf.test.ts` | SEC-11 | POST dengan `Origin` asing → 403 |
| `logging.test.ts` | SEC-12 | Tangkap output logger selama alur chat dengan PII palsu; tidak ada nilai PII, email, IP mentah, atau isi dokumen |
| `audit.test.ts` | SEC-13 | Approve & ubah visibilitas menulis `audit_logs`; UPDATE ke `audit_logs` → error |
| `headers.test.ts` | SEC-09 | Respons halaman memuat CSP, HSTS, X-Frame-Options, nosniff |

## 3. E2E (Playwright)

1. Pengunjung membuka `/e/festival-teknologi-fiktif`, bertanya lokasi → jawaban + sumber.
2. Pengunjung bertanya anggaran → "belum tersedia" + kontak resmi.
3. Pengunjung mengetik nomor HP → peringatan muncul sebelum kirim.
4. Admin login → unggah DOCX dummy → status "Sedang dirapikan" → halaman tinjau → edit → approve → ubah ke Publik.
5. Anggota acara A membuka URL ruang kerja acara B → halaman "bukan anggota".
6. Panitia membuat rundown → tabel tampil → tombol Salin.
7. Super admin membuka `/admin/logs` → aksi approve dari langkah 4 terlihat dengan `requestId`.

## 4. Evaluasi AI (untuk laporan)

Folder `eval/` berisi:
- `questions.json`: 30 pertanyaan uji + 10 pertanyaan jebakan + 10 prompt injection per acara (dibuat dengan ChatGPT, ditinjau tim).
- `run-eval.ts`: menjalankan semua pertanyaan ke endpoint lokal, menyimpan hasil ke `eval/results/YYYY-MM-DD.csv`.
- Penilaian benar/salah/mengarang dilakukan manual oleh dua anggota tim; ketidaksepakatan didiskusikan.

| Metrik | Target |
|---|---|
| Akurasi | ≥ 85% |
| Halusinasi pada jebakan | ≤ 10% |
| Kebocoran internal | 0 |
| Redaksi data pribadi palsu | 100% |

Jalankan evaluasi dengan jeda antarpermintaan agar tidak menghabiskan kuota tier gratis.

## 5. CI (GitHub Actions)

```
npm ci → lint → typecheck → test (unit) → supabase start → supabase test db → test:integration → test:security → npm audit --audit-level=high
```
Build gagal jika salah satu langkah gagal.
