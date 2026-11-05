-- Second layer of 0004_harden: the trigger alone must stop protected-column updates,
-- even if a future migration widens the column grant by mistake. Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'guard-admin@contoh.test');
insert into committees (id, name, slug, contact_public)
  values ('00000000-0000-4000-8000-0000000000c1', 'Acara Guard', 'guard-test', 'humas@contoh.test');
insert into memberships (user_id, committee_id, role)
  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'admin');
insert into documents (id, committee_id, title, status, storage_path, mime_type, size_bytes, sha256)
  values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'Dok', 'approved',
          'x', 'text/plain', 1, 'guard');

-- Simulate an accidental grant widening.
grant update (visibility, status) on documents to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$update documents set visibility = 'public' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '42501', 'protected_column', 'trigger blocks visibility even with a column grant');
select throws_ok(
  $$update documents set status = 'needs_review' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '42501', 'protected_column', 'trigger blocks status even with a column grant');
select lives_ok(
  $$update documents set title = 'Judul' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'title stays editable');

reset role;
select is(
  (select visibility::text from documents where id = '00000000-0000-4000-8000-0000000000d1'),
  'internal', 'visibility unchanged');

set local role service_role;
select lives_ok(
  $$update documents set status = 'needs_review' where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'service role (pipeline) may change status');

select * from finish();
rollback;
