-- Assertions for holding a deduction to one receipt.
--
-- `deduction_receipt_deduction_id_key` refuses a second receipt on a deduction.
-- The migration's clean-up is re-run from the migration itself over a rebuilt
-- pre-constraint state, asserting a deduction with several receipts keeps its
-- earliest and loses only the surplus rows, and a second pass changes nothing.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
\set MIGRATION ../../migrations/20260920000000_single_deduction_receipt.sql
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'receipts@example.com');
select set_config('request.jwt.claims', '{"sub":"50000000-0000-0000-0000-000000000001","email":"receipts@example.com"}', true);
set local role authenticated;

select public.create_household('Receipts', 'Alex') as hid \gset
select id as mid from public.members where household_id = :'hid' \gset
select set_config('r.hid', :'hid', false);

insert into public.deduction (id, household_id, member_id, description, amount_cents, deduction_date, financial_year)
  values
    ('cccc0000-0000-0000-0000-000000000001', :'hid', :'mid', 'Laptop', 900_00, '2026-08-01', 2027),
    ('cccc0000-0000-0000-0000-000000000002', :'hid', :'mid', 'Phone', 500_00, '2026-08-02', 2027),
    ('cccc0000-0000-0000-0000-000000000003', :'hid', :'mid', 'Desk', 300_00, '2026-08-03', 2027);

-- ── The constraint ────────────────────────────────────────────────────────────
insert into public.deduction_receipt (household_id, deduction_id, storage_path)
  values (:'hid', 'cccc0000-0000-0000-0000-000000000003', 'one.pdf');

do $$
begin
  insert into public.deduction_receipt (household_id, deduction_id, storage_path)
    values (current_setting('r.hid')::uuid, 'cccc0000-0000-0000-0000-000000000003', 'two.pdf');
  raise exception 'FAIL: a deduction accepted a second receipt';
exception
  when unique_violation then
    raise notice 'PASS: a deduction cannot hold two receipts';
end $$;

-- ── The migration's clean-up ──────────────────────────────────────────────────
reset role;
alter table public.deduction_receipt drop constraint deduction_receipt_deduction_id_key;

insert into public.deduction_receipt (id, household_id, deduction_id, storage_path, created_at) values
  ('dddd0000-0000-0000-0000-000000000002', :'hid', 'cccc0000-0000-0000-0000-000000000001', 'laptop-late.pdf', '2026-08-05'),
  ('dddd0000-0000-0000-0000-000000000001', :'hid', 'cccc0000-0000-0000-0000-000000000001', 'laptop-early.pdf', '2026-08-04'),
  ('dddd0000-0000-0000-0000-000000000003', :'hid', 'cccc0000-0000-0000-0000-000000000001', 'laptop-latest.pdf', '2026-08-06'),
  ('dddd0000-0000-0000-0000-000000000004', :'hid', 'cccc0000-0000-0000-0000-000000000002', 'phone.pdf', '2026-08-04');

\ir :MIGRATION

do $$ begin
  assert (select storage_path from public.deduction_receipt
    where deduction_id = 'cccc0000-0000-0000-0000-000000000001') = 'laptop-early.pdf',
    'a deduction with several receipts should keep its earliest';
  assert (select count(*) from public.deduction_receipt
    where deduction_id = 'cccc0000-0000-0000-0000-000000000001') = 1,
    'the surplus receipt rows should be dropped';
  assert (select storage_path from public.deduction_receipt
    where deduction_id = 'cccc0000-0000-0000-0000-000000000002') = 'phone.pdf',
    'a deduction with one receipt should be left alone';
  assert (select count(*) from public.deduction_receipt) = 3,
    'a deduction with one receipt should keep it and no row should be added';
end $$;

do $$
begin
  insert into public.deduction_receipt (household_id, deduction_id, storage_path)
    select household_id, deduction_id, 'again.pdf' from public.deduction_receipt limit 1;
  raise exception 'FAIL: the migration left no one-receipt constraint';
exception
  when unique_violation then
    raise notice 'PASS: the migration restores the one-receipt constraint';
end $$;

-- Idempotency: a second pass changes nothing.
create temp table receipt_versions as select id, ctid as row_version from public.deduction_receipt;

\ir :MIGRATION

do $$ begin
  assert not exists (
    select 1 from public.deduction_receipt r join receipt_versions v using (id)
    where r.ctid <> v.row_version),
    'a second run of the migration should rewrite no row';
  assert (select count(*) from public.deduction_receipt) = 3,
    'a second run of the migration should drop no row';
end $$;

rollback;
