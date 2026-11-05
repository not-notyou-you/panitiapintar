-- 0005_admin: Phase 2 (auth, committees, documents, members).
-- Closes gaps found while planning phase 2 (docs/DATABASE.md §2c):
--   A1 committees: admins could UPDATE status/slug/created_by directly.
--   A2 memberships: nothing kept the last admin of a committee.
--   A3 storage: bucket documents-raw and its policies did not exist.
--   A4 pii_summary: only the raw-upload scan existed, so "public only when the current version is
--      free of PII" could not be expressed. Versions now carry their own residual scan.
-- Plus: reopen_document (edit after approve), archive_committee, profiles on signup.

-- ===========================================================================
-- A1. committees: column-level update, archive only through archive_committee()
-- ===========================================================================
-- slug is immutable after creation: it is printed in QR codes. status changes via RPC (audited).
revoke update on committees from anon, authenticated;
grant update (name, event_date, location, contact_public, updated_at) on committees to authenticated;

create or replace function archive_committee(p_committee uuid, p_request_id text)
returns void language plpgsql security definer set search_path = public as $$
declare c committees;
begin
  perform doc_rpc_check_request_id(p_request_id);
  if auth.uid() is null or not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into c from committees where id = p_committee for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status = 'archived' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  update committees set status = 'archived', updated_at = now() where id = p_committee;
  insert into audit_logs(actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata, request_id)
  values (auth.uid(), 'super_admin', 'committee.archive', 'committee', p_committee::text, p_committee, 'success',
          jsonb_build_object('fields', jsonb_build_array('status')), p_request_id);
end $$;
revoke all on function archive_committee(uuid, text) from public, anon;
grant execute on function archive_committee(uuid, text) to authenticated;

-- ===========================================================================
-- A2. memberships: only the role column is updatable; the last admin stays
-- ===========================================================================
revoke update on memberships from anon, authenticated;
grant update (role) on memberships to authenticated;

create or replace function memberships_keep_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin') then
    return coalesce(new, old);
  end if;
  -- Serialise admin changes per committee. A committee being deleted (cascade) is no longer visible.
  perform 1 from committees where id = old.committee_id for update;
  if not found then return coalesce(new, old); end if;
  -- Deleting the auth user itself (account removal) cascades here; allow it.
  if current_user = 'supabase_auth_admin' then return coalesce(new, old); end if;
  if not exists (
    select 1 from memberships m
    where m.committee_id = old.committee_id and m.role = 'admin' and m.user_id <> old.user_id
  ) then
    raise exception 'last_admin' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function memberships_keep_last_admin() from public, anon, authenticated;

create trigger memberships_keep_last_admin
  before update or delete on memberships
  for each row execute function memberships_keep_last_admin();

-- ===========================================================================
-- A3. storage bucket documents-raw (private) + admin-only policies
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents-raw', 'documents-raw', false, 10485760, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- First path segment is the committee id; anything that is not a uuid maps to null (denied).
create or replace function storage_committee_id(p_name text)
returns uuid language sql immutable set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;
revoke all on function storage_committee_id(text) from public, anon;
grant execute on function storage_committee_id(text) to authenticated;

-- Super admins act as admins of every committee (guards allow them), so policies must too.
create policy documents_raw_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'documents-raw' and (is_member(storage_committee_id(name), 'admin') or is_super_admin()));
create policy documents_raw_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents-raw' and (is_member(storage_committee_id(name), 'admin') or is_super_admin()));
create policy documents_raw_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents-raw' and (is_member(storage_committee_id(name), 'admin') or is_super_admin()));

-- ===========================================================================
-- A4. residual PII per version; public requires a clean current version
-- ===========================================================================
-- documents.pii_summary keeps what the raw upload contained (counts only, shown as "disensor otomatis").
-- document_versions.pii_summary is scanPii() of that version's own content: what is still visible.
alter table document_versions
  add column pii_summary jsonb not null default '{}'::jsonb;

-- Versions are immutable once written.
revoke update on document_versions from anon, authenticated;

-- Super admins could not upload or save edits: the 0004 insert policies only admitted committee admins.
-- Same rules otherwise (internal/uploaded/version 1 for documents; own admin_edited only for versions).
drop policy documents_admin_insert on documents;
create policy documents_admin_insert on documents for insert to authenticated
  with check (
    (is_member(committee_id, 'admin') or is_super_admin())
    and visibility = 'internal'
    and status = 'uploaded'
    and approved_by is null
    and approved_at is null
    and current_version_id is null
    and version = 1
    and status_reason is null
    and pii_summary = '{}'::jsonb
    and uploaded_by = auth.uid()
  );

drop policy versions_admin_insert on document_versions;
create policy versions_admin_insert on document_versions for insert to authenticated
  with check (
    kind = 'admin_edited'
    and created_by = auth.uid()
    and exists (
      select 1 from documents d
      where d.id = document_id and (is_member(d.committee_id, 'admin') or is_super_admin())
    )
  );

create or replace function set_document_visibility(
  p_doc uuid, p_visibility doc_visibility, p_expected_version int, p_request_id text)
returns int language plpgsql security definer set search_path = public as $$
declare d documents; v_role text; v_new int; v_pii jsonb;
begin
  perform doc_rpc_check_request_id(p_request_id);
  select * into d from documents where id = p_doc for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_role := doc_rpc_actor_role(d.committee_id);
  if d.version <> p_expected_version then raise exception 'conflict' using errcode = '40001'; end if;
  if p_visibility = 'public' then
    if d.status <> 'approved' then raise exception 'not_approved' using errcode = '22023'; end if;
    select pii_summary into v_pii from document_versions where id = d.current_version_id;
    if v_pii is null or v_pii <> '{}'::jsonb then raise exception 'pii_present' using errcode = '22023'; end if;
  end if;

  perform set_config('app.doc_rpc', 'on', true);
  update documents set visibility = p_visibility, version = version + 1, updated_at = now()
    where id = p_doc returning version into v_new;
  perform set_config('app.doc_rpc', 'off', true);

  insert into audit_logs(actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata, request_id)
  values (auth.uid(), v_role, 'document.visibility.changed', 'document', p_doc::text, d.committee_id, 'success',
          jsonb_build_object('from', d.visibility, 'to', p_visibility), p_request_id);
  return v_new;
end $$;

-- ===========================================================================
-- reopen_document: an edit after approval goes back to review, and back to internal
-- ===========================================================================
create or replace function reopen_document(
  p_doc uuid, p_version_id uuid, p_expected_version int, p_request_id text)
returns int language plpgsql security definer set search_path = public as $$
declare d documents; v document_versions; v_role text; v_new int;
begin
  perform doc_rpc_check_request_id(p_request_id);
  select * into d from documents where id = p_doc for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_role := doc_rpc_actor_role(d.committee_id);
  if d.version <> p_expected_version then raise exception 'conflict' using errcode = '40001'; end if;
  if d.status <> 'approved' then raise exception 'invalid_transition' using errcode = '22023'; end if;

  select * into v from document_versions where id = p_version_id;
  if not found or v.document_id <> p_doc or v.kind <> 'admin_edited' then
    raise exception 'invalid_version' using errcode = '22023';
  end if;

  -- Secure by default: the edited text is unreviewed, so it is internal until approved and made public again.
  perform set_config('app.doc_rpc', 'on', true);
  update documents
    set status = 'needs_review', visibility = 'internal', approved_by = null, approved_at = null,
        version = version + 1, updated_at = now()
    where id = p_doc returning version into v_new;
  perform set_config('app.doc_rpc', 'off', true);

  insert into audit_logs(actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata, request_id)
  values (auth.uid(), v_role, 'document.edit_after_approve', 'document', p_doc::text, d.committee_id, 'success',
          jsonb_build_object('versionId', v.id, 'visibilityFrom', d.visibility), p_request_id);
  return v_new;
end $$;
revoke all on function reopen_document(uuid, uuid, int, text) from public, anon;
grant execute on function reopen_document(uuid, uuid, int, text) to authenticated;

-- ===========================================================================
-- profiles row for every new auth user (invited members)
-- ===========================================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===========================================================================
-- members: lookup for invites (service role only) and listing for committee admins
-- ===========================================================================
create or replace function find_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function find_user_id_by_email(text) to service_role;

-- Admins see who is in their own committee (email included: they invited these people).
create or replace function committee_members(p_committee uuid)
returns table(user_id uuid, role member_role, email text, display_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or not (is_member(p_committee, 'admin') or is_super_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.role, u.email::text, p.display_name, m.created_at
    from memberships m
    join auth.users u on u.id = m.user_id
    left join profiles p on p.user_id = m.user_id
    where m.committee_id = p_committee
    order by m.role, u.email;
end $$;
revoke all on function committee_members(uuid) from public, anon;
grant execute on function committee_members(uuid) to authenticated;
