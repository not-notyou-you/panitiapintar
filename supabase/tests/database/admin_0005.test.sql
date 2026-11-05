-- 0005_admin: committee column lock, last-admin trigger, audit-or-nothing for approve, profiles on signup.
-- Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a501', 'p5-admin@contoh.test'),
  ('00000000-0000-4000-8000-00000000a502', 'p5-member@contoh.test');
insert into committees (id, name, slug, contact_public)
  values ('00000000-0000-4000-8000-00000000c501', 'Acara P5', 'p5-test', 'humas@contoh.test');
insert into memberships (user_id, committee_id, role) values
  ('00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000c501', 'admin'),
  ('00000000-0000-4000-8000-00000000a502', '00000000-0000-4000-8000-00000000c501', 'member');
insert into documents (id, committee_id, title, status, storage_path, mime_type, size_bytes, sha256)
  values ('00000000-0000-4000-8000-00000000d501', '00000000-0000-4000-8000-00000000c501', 'Dok', 'needs_review',
          'x', 'text/plain', 1, 'p5');
insert into document_versions (id, document_id, kind, content)
  values ('00000000-0000-4000-8000-00000000e501', '00000000-0000-4000-8000-00000000d501', 'ai_refined', 'isi');

select is((select count(*)::int from profiles where user_id = '00000000-0000-4000-8000-00000000a501'), 1,
  'profile row created on signup');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a501","role":"authenticated"}';

-- A1: committee admins edit descriptive fields only.
select lives_ok($$update committees set name = 'Acara P5 baru' where id = '00000000-0000-4000-8000-00000000c501'$$,
  'admin may rename');
select throws_ok($$update committees set status = 'archived' where id = '00000000-0000-4000-8000-00000000c501'$$,
  '42501', null, 'admin cannot archive directly');
select throws_ok($$update committees set slug = 'dibajak' where id = '00000000-0000-4000-8000-00000000c501'$$,
  '42501', null, 'slug is immutable');
select throws_ok($$select archive_committee('00000000-0000-4000-8000-00000000c501', 'req_01JD3Q8Z7K2M0000000000000A')$$,
  '42501', 'forbidden', 'archive_committee is super admin only');

-- A2: last admin.
select throws_ok(
  $$update memberships set role = 'member' where user_id = '00000000-0000-4000-8000-00000000a501'$$,
  '23514', 'last_admin', 'cannot demote the last admin');
select throws_ok(
  $$delete from memberships where user_id = '00000000-0000-4000-8000-00000000a501'$$,
  '23514', 'last_admin', 'cannot remove the last admin');
select throws_ok(
  $$update memberships set committee_id = gen_random_uuid() where user_id = '00000000-0000-4000-8000-00000000a502'$$,
  '42501', null, 'membership rows cannot be moved to another committee');

-- Audit-or-nothing: make every audit insert fail, then approve must roll back completely.
reset role;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$
begin raise exception 'audit store down'; end $$;
create trigger fail_audit before insert on audit_logs for each row execute function pg_temp.fail_audit();
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a501","role":"authenticated"}';

select throws_ok(
  $$select approve_document('00000000-0000-4000-8000-00000000d501', '00000000-0000-4000-8000-00000000e501', 1,
                            'req_01JD3Q8Z7K2M0000000000000A')$$,
  'P0001', 'audit store down', 'approve fails when audit cannot be written');
reset role;
select is((select status::text from documents where id = '00000000-0000-4000-8000-00000000d501'), 'needs_review',
  'document unchanged after failed audit');
drop trigger fail_audit on audit_logs;

-- A3: bucket is private.
select is((select public from storage.buckets where id = 'documents-raw'), false, 'documents-raw is private');

select * from finish();
rollback;
