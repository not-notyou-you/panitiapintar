-- 0004_harden: closes gaps found in 0001–0003 (see docs/DATABASE.md §2b). 0001–0003 stay untouched.

-- ===========================================================================
-- A. Explicit function privileges
-- ===========================================================================
-- Supabase's default privileges grant EXECUTE on new public functions directly to anon and
-- authenticated, so "revoke ... from public" alone does not close them.
revoke execute on function rate_limit_hit(text, int, int) from anon, authenticated;
revoke execute on function purge_expired_logs(int, int, int) from anon, authenticated;

-- The 3-argument version from 0002 had no revoke and wrote audit rows without request_id.
drop function set_document_visibility(uuid, doc_visibility, int);

-- ===========================================================================
-- B. documents: column privileges (primary) + trigger (second layer)
-- ===========================================================================
revoke update on documents from anon, authenticated;
grant update (title) on documents to authenticated;

-- Rejects changes to anything except title/updated_at unless the change comes from an official
-- function (transaction-local flag app.doc_rpc) or the service role (document pipeline).
-- Seeds set app.doc_rpc explicitly.
create or replace function documents_guard_protected_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.doc_rpc', true), '') = 'on' or current_user = 'service_role' then
    return new;
  end if;
  if (to_jsonb(new) - 'title' - 'updated_at') is distinct from (to_jsonb(old) - 'title' - 'updated_at') then
    raise exception 'protected_column' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function documents_guard_protected_columns() from public, anon, authenticated;

create trigger documents_guard_protected_columns
  before update on documents
  for each row execute function documents_guard_protected_columns();

-- New documents always start as an internal, unapproved upload (SEC-04).
drop policy documents_admin_insert on documents;
create policy documents_admin_insert on documents for insert to authenticated
  with check (
    is_member(committee_id, 'admin')
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

-- ===========================================================================
-- C. document_versions: admins only add their own edits
-- ===========================================================================
-- original_redacted and ai_refined are written by the pipeline (service role).
drop policy versions_admin_insert on document_versions;
create policy versions_admin_insert on document_versions for insert to authenticated
  with check (
    kind = 'admin_edited'
    and created_by = auth.uid()
    and exists (select 1 from documents d where d.id = document_id and is_member(d.committee_id, 'admin'))
  );

-- ===========================================================================
-- D. committees: anon sees public columns only
-- ===========================================================================
revoke select on committees from anon;
grant select (id, name, slug, event_date, location, contact_public, status) on committees to anon;

-- ===========================================================================
-- E. Official document functions
-- ===========================================================================
-- Shared rules: caller must be committee admin or super admin; optimistic locking on version;
-- legal status transition; audit row with request_id written in the same transaction, so a
-- failed audit aborts the change. Each returns the new version.

create or replace function doc_rpc_actor_role(p_committee uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if is_super_admin() then return 'super_admin'; end if;
  if is_member(p_committee, 'admin') then return 'admin'; end if;
  raise exception 'forbidden' using errcode = '42501';
end $$;
revoke all on function doc_rpc_actor_role(uuid) from public, anon, authenticated;

create or replace function doc_rpc_check_request_id(p_request_id text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_request_id is null or p_request_id !~ '^req_[0-9A-HJKMNP-TV-Z]{26}$' then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
end $$;
revoke all on function doc_rpc_check_request_id(text) from public, anon, authenticated;

create or replace function set_document_visibility(
  p_doc uuid, p_visibility doc_visibility, p_expected_version int, p_request_id text)
returns int language plpgsql security definer set search_path = public as $$
declare d documents; v_role text; v_new int;
begin
  perform doc_rpc_check_request_id(p_request_id);
  select * into d from documents where id = p_doc for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_role := doc_rpc_actor_role(d.committee_id);
  if d.version <> p_expected_version then raise exception 'conflict' using errcode = '40001'; end if;
  if p_visibility = 'public' and d.status <> 'approved' then
    raise exception 'not_approved' using errcode = '22023';
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

create or replace function approve_document(
  p_doc uuid, p_version_id uuid, p_expected_version int, p_request_id text)
returns int language plpgsql security definer set search_path = public as $$
declare d documents; v document_versions; v_role text; v_new int;
begin
  perform doc_rpc_check_request_id(p_request_id);
  select * into d from documents where id = p_doc for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_role := doc_rpc_actor_role(d.committee_id);
  if d.version <> p_expected_version then raise exception 'conflict' using errcode = '40001'; end if;
  if d.status <> 'needs_review' then raise exception 'invalid_transition' using errcode = '22023'; end if;

  select * into v from document_versions where id = p_version_id;
  if not found or v.document_id <> p_doc or v.kind not in ('ai_refined', 'admin_edited') then
    raise exception 'invalid_version' using errcode = '22023';
  end if;

  perform set_config('app.doc_rpc', 'on', true);
  update documents
    set status = 'approved', current_version_id = v.id, approved_by = auth.uid(), approved_at = now(),
        status_reason = null, version = version + 1, updated_at = now()
    where id = p_doc returning version into v_new;
  perform set_config('app.doc_rpc', 'off', true);

  insert into audit_logs(actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata, request_id)
  values (auth.uid(), v_role, 'document.approve', 'document', p_doc::text, d.committee_id, 'success',
          jsonb_build_object('edited', v.kind = 'admin_edited', 'versionId', v.id), p_request_id);
  return v_new;
end $$;

create or replace function reject_document(
  p_doc uuid, p_reason_category text, p_expected_version int, p_request_id text)
returns int language plpgsql security definer set search_path = public as $$
declare d documents; v_role text; v_new int;
begin
  perform doc_rpc_check_request_id(p_request_id);
  -- A category slug, never free text, so no personal data can end up in status_reason or audit.
  if p_reason_category is null or p_reason_category !~ '^[a-z][a-z_]{0,39}$' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select * into d from documents where id = p_doc for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_role := doc_rpc_actor_role(d.committee_id);
  if d.version <> p_expected_version then raise exception 'conflict' using errcode = '40001'; end if;
  if d.status not in ('needs_review', 'refine_failed') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  perform set_config('app.doc_rpc', 'on', true);
  update documents set status = 'rejected', status_reason = p_reason_category, version = version + 1, updated_at = now()
    where id = p_doc returning version into v_new;
  perform set_config('app.doc_rpc', 'off', true);

  insert into audit_logs(actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata, request_id)
  values (auth.uid(), v_role, 'document.reject', 'document', p_doc::text, d.committee_id, 'success',
          jsonb_build_object('reasonCategory', p_reason_category, 'from', d.status), p_request_id);
  return v_new;
end $$;

revoke all on function set_document_visibility(uuid, doc_visibility, int, text) from public, anon;
revoke all on function approve_document(uuid, uuid, int, text) from public, anon;
revoke all on function reject_document(uuid, text, int, text) from public, anon;
grant execute on function set_document_visibility(uuid, doc_visibility, int, text) to authenticated;
grant execute on function approve_document(uuid, uuid, int, text) to authenticated;
grant execute on function reject_document(uuid, text, int, text) to authenticated;
