-- 0002_functions: copied verbatim from docs/DATABASE.md §3. Do not edit; add a new migration instead.

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
