-- 0001_init: copied verbatim from docs/DATABASE.md §2. Do not edit; add a new migration instead.

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
