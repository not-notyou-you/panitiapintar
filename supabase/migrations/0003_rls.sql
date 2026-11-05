-- 0003_rls: copied verbatim from docs/DATABASE.md §4. Do not edit; add a new migration instead.

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

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'append-only table'; end $$;

create trigger audit_logs_no_update before update on audit_logs for each row execute function forbid_mutation();
create trigger ai_calls_no_update   before update on ai_calls   for each row execute function forbid_mutation();
-- DELETE hanya oleh job retensi yang memakai fungsi khusus di bawah.

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
