# DATABASE — PanitiaPintar

Postgres (Supabase). **RLS aktif di semua tabel di schema `public`.** Tabel tanpa policy berarti tertutup total untuk `anon` dan `authenticated`.

## 1. Diagram relasi

```
auth.users 1─1 profiles
profiles   1─* memberships *─1 committees
committees 1─* documents 1─* document_versions
committees 1─* chat_logs
             audit_logs   (append-only)
             ai_calls     (append-only)
             rate_limits
```

## 2. Skema (migrasi `0001_init.sql`)

```sql
create extension if not exists pgcrypto;

-- ===== enum =====
create type committee_status as enum ('active','archived');
create type member_role      as enum ('admin','member');
create type doc_visibility   as enum ('internal','public');
create type doc_status       as enum ('uploaded','refining','refine_failed','needs_review','approved','rejected','archived');
create type version_kind     as enum ('original_redacted','ai_refined','admin_edited');
create type chat_mode        as enum ('public','internal','rundown','checklist');

-- ===== profiles =====
create table profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text check (char_length(display_name) <= 80),
  is_super_admin boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ===== committees =====
create table committees (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 3 and 120),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  event_date      date,
  location        text check (char_length(location) <= 200),
  contact_public  text not null check (char_length(contact_public) <= 200),  -- kontak resmi, bukan nomor pribadi
  status          committee_status not null default 'active',
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ===== memberships =====
create table memberships (
  user_id      uuid not null references auth.users(id) on delete cascade,
  committee_id uuid not null references committees(id) on delete cascade,
  role         member_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (user_id, committee_id)
);

-- ===== documents =====
create table documents (
  id                 uuid primary key default gen_random_uuid(),
  committee_id       uuid not null references committees(id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 150),
  visibility         doc_visibility not null default 'internal',
  status             doc_status not null default 'uploaded',
  storage_path       text not null,
  mime_type          text not null check (mime_type in (
                       'application/pdf',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                       'text/plain','text/markdown')),
  size_bytes         integer not null check (size_bytes between 1 and 10485760),
  sha256             text not null,
  pii_summary        jsonb not null default '{}'::jsonb,   -- {"phone":2,"email":1} — jumlah saja, TANPA nilai
  current_version_id uuid,
  status_reason      text check (char_length(status_reason) <= 300),
  version            integer not null default 1,           -- optimistic locking
  uploaded_by        uuid references auth.users(id),
  approved_by        uuid references auth.users(id),
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (committee_id, sha256)                              -- cegah unggah ganda
);
create index documents_committee_idx on documents(committee_id, status, visibility);

create table document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  kind         version_kind not null,
  content      text not null check (char_length(content) <= 200000),
  created_by   uuid references auth.users(id),   -- null = sistem/AI
  created_at   timestamptz not null default now()
);
alter table documents add constraint documents_current_version_fk
  foreign key (current_version_id) references document_versions(id);

-- ===== chat_logs (teks SUDAH diredaksi) =====
create table chat_logs (
  id                  bigint generated always as identity primary key,
  committee_id        uuid not null references committees(id) on delete cascade,
  mode                chat_mode not null,
  user_id             uuid references auth.users(id) on delete set null,  -- null untuk publik
  question_redacted   text not null check (char_length(question_redacted) <= 1000),
  answered            boolean not null,           -- false = "info tidak tersedia"
  source_doc_ids      uuid[] not null default '{}',
  pii_types_redacted  text[] not null default '{}',
  request_id          text not null,
  created_at          timestamptz not null default now()
);
create index chat_logs_committee_idx on chat_logs(committee_id, created_at desc);

-- ===== audit_logs (append-only) =====
create table audit_logs (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,                -- null = sistem
  actor_role    text not null,       -- super_admin | admin | member | system
  action        text not null,       -- lihat LOGGING.md §6
  target_type   text not null,       -- committee | document | membership | system
  target_id     text,
  committee_id  uuid,
  outcome       text not null check (outcome in ('success','denied','failure')),
  metadata      jsonb not null default '{}'::jsonb,   -- TANPA data pribadi
  request_id    text,
  ip_hash       text
);
create index audit_logs_time_idx on audit_logs(occurred_at desc);
create index audit_logs_committee_idx on audit_logs(committee_id, occurred_at desc);

-- ===== ai_calls (metadata saja, tanpa isi prompt/jawaban) =====
create table ai_calls (
  id                 bigint generated always as identity primary key,
  occurred_at        timestamptz not null default now(),
  request_id         text not null,
  purpose            text not null check (purpose in ('refine','chat_public','chat_internal','rundown','checklist')),
  committee_id       uuid,
  model              text not null,
  fallback_used      boolean not null default false,
  attempt            smallint not null default 1,
  status             text not null check (status in ('ok','timeout','rate_limited','blocked','error','invalid_output')),
  latency_ms         integer not null,
  input_tokens       integer,
  output_tokens      integer,
  prompt_sha256      text not null,   -- untuk korelasi, bukan isi
  context_doc_ids    uuid[] not null default '{}',
  error_code         text
);
create index ai_calls_time_idx on ai_calls(occurred_at desc);

-- ===== rate_limits =====
create table rate_limits (
  bucket       text not null,       -- mis. 'chat_public:min:<ipHash>'
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);
```

## 2b. Pengerasan (migrasi `0004_harden.sql`)

Menutup celah di `0001`–`0003` tanpa mengubah file lama. Sumber kebenaran: [`supabase/migrations/0004_harden.sql`](../supabase/migrations/0004_harden.sql).

| Celah di 0001–0003 | Perbaikan di 0004 |
|---|---|
| `documents_admin_update` mengizinkan admin `UPDATE` `visibility`/`status`/`approved_*` langsung, sehingga cek approval, locking, dan audit terlewati | `revoke update on documents from anon, authenticated; grant update (title) … to authenticated` + trigger `documents_guard_protected_columns` (lapis kedua) |
| Policy insert hanya mengecek `visibility = 'internal'` (admin bisa insert `status = 'approved'`) | `with check`: `internal`, `uploaded`, `approved_by`/`approved_at`/`current_version_id`/`status_reason` null, `version = 1`, `pii_summary = '{}'`, `uploaded_by = auth.uid()` |
| Admin bisa menulis versi `ai_refined`/`original_redacted` palsu | Admin hanya `kind = 'admin_edited'` dengan `created_by = auth.uid()` |
| `set_document_visibility` (3 argumen) tanpa `revoke`, audit tanpa `request_id` | Di-`drop`; diganti versi 4 argumen dengan `p_request_id` |
| Default privileges Supabase memberi `EXECUTE` langsung ke `anon`/`authenticated`, jadi `revoke … from public` tidak cukup untuk `rate_limit_hit` & `purge_expired_logs` | `revoke execute … from anon, authenticated` eksplisit |
| `anon` bisa membaca semua kolom `committees` (termasuk `created_by`) | `revoke select … from anon; grant select (id, name, slug, event_date, location, contact_public, status) … to anon` |

### Trigger `documents_guard_protected_columns`
`BEFORE UPDATE` pada `documents`: menolak (`42501 protected_column`) perubahan kolom apa pun selain `title` dan `updated_at`, kecuali:
- `current_setting('app.doc_rpc', true) = 'on'`. Flag ini di-set lokal-transaksi (`set_config(…, true)`) hanya di dalam fungsi resmi, dan dimatikan lagi tepat setelah `UPDATE`;
- `current_user = 'service_role'`: pipeline sistem (`uploaded` → `refining` → `needs_review`/`refine_failed`, `pii_summary`, `status_reason`).

Seed yang perlu mengubah kolom terlindungi wajib men-set `app.doc_rpc` secara eksplisit.

### Fungsi resmi dokumen
Semua `security definer`, `set search_path = public`, `revoke all … from public, anon`, `grant execute … to authenticated`. Mengembalikan `version` baru.

| Fungsi | Transisi sah | Audit (`action`, `metadata`) |
|---|---|---|
| `approve_document(p_doc, p_version_id, p_expected_version, p_request_id)` | `needs_review` → `approved`; `p_version_id` wajib milik dokumen yang sama dan `kind` `ai_refined`/`admin_edited` | `document.approve`, `{edited, versionId}` |
| `reject_document(p_doc, p_reason_category, p_expected_version, p_request_id)` | `needs_review`/`refine_failed` → `rejected`; kategori berupa slug `^[a-z][a-z_]{0,39}$` | `document.reject`, `{reasonCategory, from}` |
| `set_document_visibility(p_doc, p_visibility, p_expected_version, p_request_id)` | `public` hanya untuk `approved` | `document.visibility.changed`, `{from, to}` |

Pengecekan bersama: peran admin kepanitiaan atau super admin (`42501 forbidden`), `version = p_expected_version` (`40001 conflict`), `p_request_id` berformat `req_` + ULID (`22023 invalid_request_id`). Audit ditulis di transaksi yang sama, jadi gagal audit berarti aksi batal.

Helper internal `doc_rpc_actor_role(uuid)` dan `doc_rpc_check_request_id(text)` tidak bisa dipanggil pengguna.

## 2c. Fase 2 (migrasi `0005_admin.sql`)

Sumber kebenaran: [`supabase/migrations/0005_admin.sql`](../supabase/migrations/0005_admin.sql); test: `supabase/tests/database/admin_0005.test.sql`.

| Celah / kebutuhan | Perubahan |
|---|---|
| Admin panitia bisa `UPDATE` `committees.status`/`slug`/`created_by` langsung | `grant update (name, event_date, location, contact_public, updated_at)` saja; arsip via `archive_committee(p_committee, p_request_id)` (super admin, audit `committee.archive` di transaksi yang sama) |
| Admin terakhir bisa diturunkan/dihapus | Trigger `memberships_keep_last_admin` (`23514 last_admin`, kunci baris `committees`); kolom yang bisa di-`UPDATE` hanya `role`. Cascade karena acara/akun dihapus tetap boleh |
| Bucket storage belum ada | Bucket privat `documents-raw` (10 MB, 4 MIME) + policy `select/insert/delete` untuk admin kepanitiaan atau super admin; segmen pertama path diparse `storage_committee_id()` (bukan UUID → ditolak) |
| `pii_summary` hanya dari file mentah, sehingga dokumen yang PII-nya sudah disensor tidak pernah bisa publik | Kolom `document_versions.pii_summary` (sisa PII versi itu); `set_document_visibility` menolak `public` bila versi terkini tidak `{}` (`22023 pii_present`); versi tidak bisa di-`UPDATE` |
| Edit setelah approved | `reopen_document(p_doc, p_version_id, p_expected_version, p_request_id)`: `approved` → `needs_review`, `visibility` → `internal`, audit `document.edit_after_approve` |
| Super admin tidak bisa unggah/menyimpan edit | Policy `documents_admin_insert` dan `versions_admin_insert` menerima `is_super_admin()` (aturan lain sama dengan 0004) |
| Anggota yang diundang tidak punya baris `profiles` | Trigger `on_auth_user_created` → `handle_new_user()` (`on conflict do nothing`; seed memakai upsert) |
| Undangan & daftar anggota | `find_user_id_by_email(text)` (service role saja); `committee_members(p_committee)` untuk admin/super admin (termasuk email anggota acaranya sendiri) |

## 3. Fungsi bantu (migrasi `0002_functions.sql`)

```sql
-- Apakah pengguna anggota (opsional dengan peran tertentu)?
create or replace function is_member(cid uuid, required member_role default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.committee_id = cid and m.user_id = auth.uid()
      and (required is null or m.role = required)
  );
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from profiles where user_id = auth.uid()), false);
$$;

-- SATU-SATUNYA jalur baca konteks mode publik.
create or replace function public_context(p_slug text)
returns table(document_id uuid, title text, content text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.title, v.content, d.updated_at
  from committees c
  join documents d          on d.committee_id = c.id
  join document_versions v  on v.id = d.current_version_id
  where c.slug = p_slug
    and c.status = 'active'
    and d.status = 'approved'
    and d.visibility = 'public'
  order by d.title;
$$;
revoke all on function public_context(text) from public;
grant execute on function public_context(text) to anon, authenticated;

-- Rate limit atomik. Mengembalikan true jika masih diizinkan.
create or replace function rate_limit_hit(p_bucket text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
        n int;
begin
  insert into rate_limits(bucket, window_start, hits) values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  return n <= p_max;
end $$;
revoke all on function rate_limit_hit(text,int,int) from public;
grant execute on function rate_limit_hit(text,int,int) to service_role;

-- Ubah visibilitas: hanya admin kepanitiaan, hanya dokumen approved, wajib bebas PII.
create or replace function set_document_visibility(p_doc uuid, p_visibility doc_visibility, p_expected_version int)
returns void language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  select * into d from documents where id = p_doc for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not is_member(d.committee_id, 'admin') and not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501'; end if;
  if d.version <> p_expected_version then raise exception 'conflict' using errcode = '40001'; end if;
  if p_visibility = 'public' and d.status <> 'approved' then raise exception 'not_approved'; end if;
  update documents set visibility = p_visibility, version = version + 1, updated_at = now() where id = p_doc;
  insert into audit_logs(actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata)
  values (auth.uid(), case when is_super_admin() then 'super_admin' else 'admin' end,
          'document.visibility.changed', 'document', p_doc::text, d.committee_id, 'success',
          jsonb_build_object('from', d.visibility, 'to', p_visibility));
end $$;
```

Catatan: fungsi 3-argumen di atas digantikan versi 4-argumen di §2b. Pemeriksaan "bebas PII" untuk publik dilakukan di aplikasi sebelum memanggil fungsi ini (versi yang disetujui sudah melewati `redact()`), dan fungsi tetap menolak dokumen yang belum `approved`.

## 4. Row Level Security (migrasi `0003_rls.sql`)

```sql
alter table profiles          enable row level security;
alter table committees        enable row level security;
alter table memberships       enable row level security;
alter table documents         enable row level security;
alter table document_versions enable row level security;
alter table chat_logs         enable row level security;
alter table audit_logs        enable row level security;
alter table ai_calls          enable row level security;
alter table rate_limits       enable row level security;

-- profiles
create policy profiles_self_read  on profiles for select to authenticated using (user_id = auth.uid() or is_super_admin());
create policy profiles_self_upd   on profiles for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_super_admin = (select p.is_super_admin from profiles p where p.user_id = auth.uid()));

-- committees: info dasar acara aktif boleh dibaca publik (nama, tanggal, kontak resmi)
create policy committees_public_read on committees for select to anon, authenticated using (status = 'active' or is_member(id) or is_super_admin());
create policy committees_super_write on committees for all to authenticated using (is_super_admin()) with check (is_super_admin());
create policy committees_admin_update on committees for update to authenticated using (is_member(id,'admin')) with check (is_member(id,'admin'));

-- memberships
create policy memberships_read  on memberships for select to authenticated using (user_id = auth.uid() or is_member(committee_id,'admin') or is_super_admin());
create policy memberships_write on memberships for all    to authenticated using (is_member(committee_id,'admin') or is_super_admin())
  with check (is_member(committee_id,'admin') or is_super_admin());

-- documents: TIDAK ada policy untuk anon. Publik hanya via public_context().
create policy documents_member_read on documents for select to authenticated using (is_member(committee_id) or is_super_admin());
create policy documents_admin_insert on documents for insert to authenticated with check (is_member(committee_id,'admin') and visibility = 'internal');
create policy documents_admin_update on documents for update to authenticated using (is_member(committee_id,'admin'))
  with check (is_member(committee_id,'admin'));
create policy documents_admin_delete on documents for delete to authenticated using (is_member(committee_id,'admin') or is_super_admin());

-- document_versions
create policy versions_member_read on document_versions for select to authenticated
  using (exists (select 1 from documents d where d.id = document_id and (is_member(d.committee_id) or is_super_admin())));
create policy versions_admin_insert on document_versions for insert to authenticated
  with check (exists (select 1 from documents d where d.id = document_id and is_member(d.committee_id,'admin')));

-- chat_logs: dibaca admin kepanitiaan; ditulis oleh server (service role)
create policy chat_logs_admin_read on chat_logs for select to authenticated using (is_member(committee_id,'admin') or is_super_admin());

-- audit_logs & ai_calls: hanya super admin yang membaca; tidak ada policy tulis (service role / security definer saja)
create policy audit_super_read on audit_logs for select to authenticated using (is_super_admin());
create policy ai_calls_super_read on ai_calls for select to authenticated using (is_super_admin());

-- rate_limits: tidak ada policy (hanya service role)
```

### Append-only untuk log

```sql
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'append-only table'; end $$;

create trigger audit_logs_no_update before update on audit_logs for each row execute function forbid_mutation();
create trigger ai_calls_no_update   before update on ai_calls   for each row execute function forbid_mutation();
-- DELETE hanya oleh job retensi yang memakai fungsi khusus di bawah.
```

```sql
create or replace function purge_expired_logs(p_chat_days int, p_ai_days int, p_audit_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; r int;
begin
  -- chat_logs: dihapus p_chat_days setelah tanggal acara; acara tanpa tanggal: setelah p_chat_days sejak dibuat
  delete from chat_logs cl using committees c
    where cl.committee_id = c.id
      and now() > coalesce(c.event_date::timestamptz, cl.created_at) + make_interval(days => p_chat_days);
  get diagnostics a = row_count;
  -- trigger hanya memblokir UPDATE, jadi DELETE di sini tidak terhalang
  delete from ai_calls    where occurred_at < now() - make_interval(days => p_ai_days);    get diagnostics b = row_count;
  delete from audit_logs  where occurred_at < now() - make_interval(days => p_audit_days); get diagnostics c = row_count;
  delete from rate_limits where window_start < now() - interval '2 days';                   get diagnostics r = row_count;
  return jsonb_build_object('chat_logs',a,'ai_calls',b,'audit_logs',c,'rate_limits',r);
end $$;
revoke all on function purge_expired_logs(int,int,int) from public;
grant execute on function purge_expired_logs(int,int,int) to service_role;
```

## 5. Storage

- Bucket `documents-raw`: **privat**, tanpa akses publik.
- Path: `{committee_id}/{document_id}.{ext}`.
- Policy storage: `select`/`insert`/`delete` hanya jika `is_member(committee_id,'admin')` atau super admin (committee_id diambil dari segmen pertama path lewat `storage_committee_id()`). Dibuat di `0005_admin`.
- Unduhan file asli hanya lewat signed URL berumur 60 detik, khusus admin kepanitiaan.

## 6. Seed (`supabase/seed/`)

- 3 acara fiktif dengan slug `festival-teknologi-fiktif`, `lomba-desain-fiktif`, `seminar-karier-fiktif`.
- Per acara 4–5 dokumen dummy buatan ChatGPT: guidebook, rundown publik, FAQ (publik); anggaran, notulensi rapat (internal).
- Dokumen internal sengaja berisi **data pribadi palsu** (nomor HP `0812-0000-xxxx`, email `@contoh.test`, NIM `0000099xxxx`) untuk uji redaksi.
- 1 super admin, 1 admin + 1 anggota per acara, semua email `@contoh.test`.

## 7. Aturan migrasi

- Satu perubahan skema = satu file migrasi baru, bernomor urut.
- Setiap tabel baru **wajib** `enable row level security` di migrasi yang sama, beserta policy-nya dan test di `tests/security/rls.test.ts`.
- Fungsi `security definer` **wajib** `set search_path = public` dan `revoke ... from public`, **serta** `revoke ... from anon, authenticated` bila tidak memang untuk mereka (default privileges Supabase memberi grant langsung).
- Test SQL lapis trigger: `supabase/tests/database/*.test.sql` (pgTAP, `npx supabase test db`).
