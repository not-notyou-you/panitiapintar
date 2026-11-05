# LOGGING — PanitiaPintar

Tujuan: setiap kejadian penting bisa ditelusuri dari awal sampai akhir, **tanpa** menyimpan data pribadi atau isi dokumen.

## 1. Empat jenis catatan

| Jenis | Tempat | Isi | Siapa membaca | Retensi |
|---|---|---|---|---|
| **Log aplikasi** | stdout (JSON, pino) → Vercel Logs | Semua request, error, event teknis | Tim developer | Mengikuti Vercel (singkat) |
| **Audit log** | Tabel `audit_logs` | Tindakan sensitif: login, ubah visibilitas, approve, kelola anggota, penolakan akses | Super admin (`/admin/logs`) | 180 hari |
| **AI call log** | Tabel `ai_calls` | Metadata tiap panggilan Gemini: model, latensi, token, status | Super admin | 90 hari |
| **Chat log** | Tabel `chat_logs` | Pertanyaan **teredaksi**, terjawab/tidak, dokumen sumber | Admin kepanitiaan | 30 hari setelah tanggal acara |

## 2. Format log aplikasi

Satu baris JSON per event:

```json
{
  "level": "info",
  "time": "2026-11-20T03:14:15.926Z",
  "event": "chat.public.answered",
  "requestId": "req_01JD3Q8Z7K2M",
  "env": "production",
  "route": "POST /api/chat/public",
  "committeeId": "8f1c…",
  "actor": { "type": "anonymous", "ipHash": "a91f…" },
  "durationMs": 2140,
  "ai": { "model": "gemini-…-flash-lite", "latencyMs": 1890, "inputTokens": 5210, "outputTokens": 142, "fallbackUsed": false },
  "result": { "answered": true, "sourceCount": 2, "piiRedacted": ["phone"] }
}
```

### Field wajib
| Field | Keterangan |
|---|---|
| `level` | `trace` · `debug` · `info` · `warn` · `error` · `fatal` |
| `time` | ISO 8601 UTC |
| `event` | Nama dari katalog §5 |
| `requestId` | Dari middleware; juga dikirim di header respons `x-request-id` dan di body error |
| `env` | `development` · `preview` · `production` |

### Field kontekstual (bila ada)
`route`, `committeeId`, `documentId`, `actor.type` (`anonymous`/`member`/`admin`/`super_admin`/`system`), `actor.userId`, `actor.ipHash`, `durationMs`, `error.code`, `error.message` (tanpa data pengguna), `error.stack` (hanya level `error`/`fatal`).

### Level
| Level | Kapan | Contoh |
|---|---|---|
| `debug` | Detail alur, hanya di development | konteks berisi 3 dokumen, 12.400 karakter |
| `info` | Kejadian normal yang perlu jejak | chat terjawab, dokumen di-approve |
| `warn` | Tidak normal tapi tertangani | rate limit, fallback model dipakai, akses ditolak |
| `error` | Gagal dan pengguna terdampak | Gemini error setelah retry, ekstraksi gagal |
| `fatal` | Pelanggaran keamanan / sistem tidak bisa jalan | kanari bocor, env hilang |

Production: level minimum `info`. Development: `debug`.

## 3. Yang DILARANG dicatat

| Jangan dicatat | Gantinya |
|---|---|
| Pertanyaan atau pesan **sebelum** redaksi | Jenis PII yang ditemukan: `piiRedacted: ["phone"]` |
| Isi dokumen, isi prompt, isi jawaban AI | `promptSha256`, panjang karakter, ID dokumen |
| Email | `emailHash` (HMAC) |
| IP | `ipHash` (HMAC dengan salt rotasi bulanan) |
| Token, cookie, header `Authorization`, kunci API | Tidak ada |
| Nama file asli dari pengguna | `documentId` |
| Nilai PII yang ditemukan pemindai | Jumlah per jenis |

Pengaman otomatis di `lib/log/logger.ts`:
```ts
pino({
  redact: {
    paths: ["req.headers.authorization","req.headers.cookie","*.password","*.token","*.apiKey",
            "*.email","*.ip","*.content","*.prompt","*.answer","*.message"],
    censor: "[REDACTED]"
  },
  // plus hook formatters.log: jalankan privacy.redact() pada semua string bebas
});
```
Test `tests/security/logging.test.ts` memastikan string PII palsu tidak pernah muncul di output logger.

## 4. Korelasi

```
Browser ──x-request-id──► middleware (buat/terima requestId)
                              │
           ┌──────────────────┼──────────────────────┐
     log aplikasi        audit_logs.request_id   ai_calls.request_id   chat_logs.request_id
```

- `requestId` format `req_` + ULID.
- Pesan error di UI menampilkan `Kode: req_01JD…` agar pengguna bisa melapor dan tim menelusuri.
- Panggilan Gemini membawa `requestId` + `attempt` sehingga retry/fallback terlihat berurutan.

## 5. Katalog event (log aplikasi)

Format nama: `domain.action.result`.

### Request
| Event | Level | Field tambahan |
|---|---|---|
| `http.request.completed` | info | `method`, `route`, `status`, `durationMs` |
| `http.request.failed` | error | `status`, `error.code` |

### Auth
| Event | Level | Field |
|---|---|---|
| `auth.magiclink.requested` | info | `emailHash` |
| `auth.login.succeeded` | info | `userId` |
| `auth.login.failed` | warn | `reason` |
| `auth.logout.completed` | info | `userId` |
| `auth.access.denied` | warn | `userId?`, `route`, `required` (`member`/`admin`/`super_admin`), `committeeId?` |

### Chat dan generator
| Event | Level | Field |
|---|---|---|
| `chat.public.received` | debug | `committeeId`, `messageLength`, `historyTurns` |
| `chat.public.answered` | info | `answered`, `sourceCount`, `piiRedacted[]`, `durationMs` |
| `chat.public.unavailable` | info | `reason` (`committee_archived`/`no_public_docs`) |
| `chat.internal.answered` | info | `userId`, `containsInternal`, `sourceCount` |
| `generate.rundown.completed` | info | `userId`, `rows` |
| `generate.checklist.completed` | info | `userId`, `items` |
| `chat.pii.redacted` | info | `types[]`, `count`, `stage` (`input`/`history`/`output`) |
| `chat.log.write_failed` | error | `mode` (jawaban tetap dikirim ke pengguna) |

### AI
| Event | Level | Field |
|---|---|---|
| `ai.call.started` | debug | `purpose`, `model`, `attempt`, `contextChars` |
| `ai.call.succeeded` | info | `purpose`, `model`, `latencyMs`, `inputTokens`, `outputTokens` |
| `ai.call.retried` | warn | `attempt`, `reason` |
| `ai.call.fallback` | warn | `fromModel`, `toModel` |
| `ai.call.rate_limited` | warn | `model` |
| `ai.call.blocked` | warn | `blockReason` |
| `ai.call.timeout` | error | `timeoutMs` |
| `ai.call.failed` | error | `error.code` |
| `ai.output.invalid` | error | `purpose`, `validationErrors` (path saja) |
| `ai.calls.write_failed` | error | `purpose` (panggilan AI tetap dilanjutkan) |

### Dokumen
| Event | Level | Field |
|---|---|---|
| `document.upload.received` | info | `committeeId`, `mimeType`, `sizeBytes` |
| `document.upload.rejected` | warn | `reason` (`bad_type`/`too_large`/`encrypted`/`macro`/`zip_bomb`/`duplicate`/`quota`) |
| `document.extract.completed` | info | `chars`, `durationMs` |
| `document.extract.failed` | error | `error.code` |
| `document.pii.scanned` | info | `summary` (jumlah per jenis) |
| `document.refine.started` | info | `documentId` |
| `document.refine.completed` | info | `documentId`, `sections`, `faqCount` |
| `document.refine.failed` | error | `documentId`, `error.code` |
| `document.review.approved` | info | `documentId`, `edited` (bool) |
| `document.review.rejected` | info | `documentId` |
| `document.visibility.changed` | info | `documentId`, `from`, `to` |
| `document.deleted` | info | `documentId` |

### Kepanitiaan dan anggota
| Event | Level |
|---|---|
| `committee.created` / `committee.updated` / `committee.archived` | info |
| `membership.invited` / `membership.role_changed` / `membership.removed` | info |

### Keamanan dan sistem
| Event | Level | Field |
|---|---|---|
| `ratelimit.exceeded` | warn | `bucket`, `limit` |
| `security.csrf.blocked` | warn | `origin` |
| `security.upload.suspicious` | warn | `reason` |
| `security.canary.leaked` | **fatal** | `committeeId`, `canaryId` |
| `security.rls.denied` | warn | `table`, `operation` |
| `config.env.invalid` | fatal | `missing[]` |
| `retention.purge.completed` | info | jumlah baris per tabel |
| `retention.purge.failed` | error | `error.code` |
| `health.check.degraded` | warn | `db`, `ai` |

## 6. Katalog aksi audit (`audit_logs.action`)

| Action | Target | Metadata (tanpa PII) |
|---|---|---|
| `auth.login` | system | `method` |
| `auth.access_denied` | committee/document | `required`, `route` |
| `committee.create` / `committee.update` / `committee.archive` | committee | field yang berubah (nama field saja) |
| `membership.add` / `membership.role_change` / `membership.remove` | membership | `role`, `from`, `to` |
| `document.upload` | document | `mimeType`, `sizeBytes`, `piiSummary` |
| `document.approve` | document | `edited`, `versionId` |
| `document.reject` | document | `reasonCategory` |
| `document.edit_after_approve` | document | `versionId` |
| `document.visibility.changed` | document | `from`, `to` |
| `document.delete` | document | `status` saat dihapus |
| `document.raw_download` | document | — |
| `security.canary_leaked` | committee | `canaryId` |
| `system.retention_purge` | system | jumlah baris |

Outcome: `success` · `denied` · `failure`.

## 7. Implementasi

```ts
// lib/log/logger.ts
export const logger = pino({ level: env.LOG_LEVEL, base: { env: env.APP_ENV }, redact: {...}, formatters: {...} });
export function withRequest(requestId: string, extra?: object) { return logger.child({ requestId, ...extra }); }

// lib/log/audit.ts
export async function audit(entry: AuditEntry): Promise<void>
//   - validasi zod (action dari enum katalog §6)
//   - metadata dilewatkan redactDeep()
//   - tulis via service role; jika gagal: logger.error("audit.write.failed") — TIDAK menggagalkan request utama,
//     KECUALI untuk aksi document.visibility.changed dan document.approve (gagal audit = batalkan aksi)

// lib/ai/with-ai-logging.ts
export async function withAiLogging<T>(meta: AiCallMeta, fn: () => Promise<T>): Promise<T>
//   - ukur latensi, tangkap status (ok/timeout/rate_limited/blocked/error/invalid_output)
//   - tulis ai_calls + log ai.call.*
```

Pola di route handler:
```ts
export const POST = withRequestLog("POST /api/chat/public", async (req, log) => {
  // log sudah membawa requestId; withRequestLog mencatat http.request.completed/failed + durationMs
});
```

## 8. Halaman log untuk super admin (`/admin/logs`)

- Tab **Audit**: filter waktu, kepanitiaan, aksi, outcome; kolom waktu, aktor (nama tampilan), aksi, target, outcome, `requestId`.
- Tab **AI**: grafik panggilan per jam, rata-rata latensi, tingkat error dan fallback, total token per hari, sisa kuota perkiraan.
- Tab **Keamanan**: daftar `denied`, `ratelimit.exceeded`, `canary.leaked` 7 hari terakhir.
- Ekspor CSV untuk lampiran laporan evaluasi.
- Admin kepanitiaan melihat **chat log** acaranya sendiri: pertanyaan teredaksi yang tidak terjawab, untuk memperbaiki dokumen.

## 9. Retensi

Job `GET /api/cron/retention` (Vercel Cron, harian 02.00 WIB, dilindungi `CRON_SECRET`) memanggil `purge_expired_logs(30, 90, 180)` dan mencatat `retention.purge.completed`.
