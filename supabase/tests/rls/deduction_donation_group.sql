-- Assertions for filing a member's donations into their "Donations" group.
--
-- A `donation` deduction written with no group of its own is filed into the
-- member's "Donations" group for its financial year by the
-- `file_donation_in_default_group` trigger, that group being created the first
-- time it is needed. A donation the member filed elsewhere keeps that group,
-- and a work expense or tax agent fee is never auto-grouped. This script proves
-- the trigger on live writes, then rebuilds a pre-trigger state and re-runs the
-- backfill from the migration itself, asserting it groups exactly the standalone
-- donations and rewrites nothing on a second pass.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
\set MIGRATION ../../migrations/20260913000000_donation_default_group.sql
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'donations@example.com'),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'backfill@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000009","email":"donations@example.com"}', true);
select public.create_household('Givers', 'Robin') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

-- ── The trigger, on live writes ──────────────────────────────────────────────

-- A donation with no group creates the member's "Donations" group and lands in
-- it.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Red Cross', 100_00, '2026-08-01', 2027, 'donation')
  returning id as db_d1 \gset
select set_config('db.d1', :'db_d1', false);

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
begin
  assert (select count(*) from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and name = 'Donations') = 1,
    'the first donation should create the member''s Donations group for the year';
  assert (select group_id from public.deduction where id = current_setting('db.d1')::uuid) = (
    select id from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and name = 'Donations'),
    'the first donation should be filed into that group';
end $$;

-- A second donation reuses the same group.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'MSF', 50_00, '2026-09-01', 2027, 'donation');

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
begin
  assert (select count(*) from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and name = 'Donations') = 1,
    'a second donation should reuse the Donations group, not create another';
  assert (select count(*) from public.deduction d
    join public.deduction_group g on g.id = d.group_id
    where g.name = 'Donations' and d.financial_year = 2027) = 2,
    'both donations should sit in the Donations group';
end $$;

-- A donation filed into a group of the member's own keeps it.
insert into public.deduction_group (household_id, member_id, name, financial_year)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Local school fund', 2027)
  returning id as db_school \gset
select set_config('db.school', :'db_school', false);

insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, group_id)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'School raffle', 20_00, '2026-10-01', 2027, 'donation', current_setting('db.school')::uuid)
  returning id as db_d3 \gset
select set_config('db.d3', :'db_d3', false);

do $$ begin
  assert (select group_id from public.deduction where id = current_setting('db.d3')::uuid) = current_setting('db.school')::uuid,
    'a donation filed into a named group should stay there';
end $$;

-- Clearing a donation's group snaps it back to Donations.
update public.deduction set group_id = null where id = current_setting('db.d3')::uuid;

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
begin
  assert (select group_id from public.deduction where id = current_setting('db.d3')::uuid) = (
    select id from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and name = 'Donations'),
    'clearing a donation''s group should re-file it into Donations';
end $$;

-- A work expense with no group is left standing, and no Donations group is made
-- for a year that has only work expenses.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Union fees', 500_00, '2025-08-01', 2026, 'work_expense');

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert (select group_id from public.deduction where description = 'Union fees') is null,
    'a work expense with no group should stay standalone';
  assert not exists (select 1 from public.deduction_group where household_id = v_hid and financial_year = 2026),
    'a year of only work expenses should have no Donations group';
end $$;

-- A donation in a different year gets its own Donations group.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Salvos', 30_00, '2025-09-01', 2026, 'donation');

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert (select count(*) from public.deduction_group where household_id = v_hid and name = 'Donations') = 2,
    'each financial year with a donation should get its own Donations group';
end $$;

-- The add path files a donation into Donations too: create_deduction_with_receipts
-- inserts into deduction, so the trigger fires on it.
select public.create_deduction_with_receipts(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Oxfam',
    'amount_cents', 25_00,
    'deduction_date', '2026-11-01',
    'financial_year', 2027,
    'category', 'donation'
  ),
  '[]'::jsonb
) as db_added \gset
select set_config('db.added', :'db_added', false);

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
begin
  assert (select group_id from public.deduction where id = current_setting('db.added')::uuid) = (
    select id from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and name = 'Donations'),
    'a donation added through the RPC should be filed into Donations';
end $$;

-- ── The backfill, run from the migration itself ──────────────────────────────
--
-- The pre-trigger state — standalone donations — is built with the trigger off
-- and as the table's owner rather than a member. A separate auth user owns this
-- household so the first user is never in two.
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-00000000000a","email":"backfill@example.com"}', true);
select public.create_household('Backfillers', 'Alex') as bf_hid \gset
select set_config('bf.hid', :'bf_hid', false);
select id as bf_mid from public.members where household_id = current_setting('bf.hid')::uuid \gset
select set_config('bf.mid', :'bf_mid', false);

-- One scope already has a "Donations" group; the backfill must reuse it.
insert into public.deduction_group (household_id, member_id, name, financial_year)
  values (current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Donations', 2027)
  returning id as bf_existing \gset
select set_config('bf.existing', :'bf_existing', false);

reset role;
alter table public.deduction disable trigger file_donation_in_default_group;

-- `updated_at` is seeded to a date no write in this transaction can produce, so
-- a row the backfill's UPDATE skips is provably untouched.
insert into public.deduction
    (id, household_id, member_id, description, amount_cents, deduction_date, financial_year, category, full_amount_cents, work_use_percent, updated_at)
  values
    ('bbbb0000-0000-0000-0000-000000000001', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'RSPCA', 40_00, '2026-08-01', 2027, 'donation', 40_00, 100, '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000002', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Beyond Blue', 60_00, '2026-09-01', 2027, 'donation', 60_00, 100, '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000003', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Cancer Council', 15_00, '2025-08-01', 2026, 'donation', 15_00, 100, '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000004', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Laptop', 900_00, '2026-08-01', 2027, 'work_expense', 900_00, 100, '2020-01-01');

alter table public.deduction enable trigger file_donation_in_default_group;

\ir :MIGRATION

do $$
declare v_hid uuid := current_setting('bf.hid')::uuid;
        v_mid uuid := current_setting('bf.mid')::uuid;
        v_2027 uuid;
        v_2026 uuid;
begin
  select id into v_2027 from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and name = 'Donations';
  select id into v_2026 from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2026 and name = 'Donations';

  assert v_2027 = current_setting('bf.existing')::uuid,
    'the backfill should reuse an existing Donations group, not add a second';
  assert (select count(*) from public.deduction_group
    where household_id = v_hid and name = 'Donations') = 2,
    'the backfill should create exactly one Donations group per year that needs one';

  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000001') = v_2027,
    'a standalone FY2027 donation should be moved into that year''s Donations group';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000002') = v_2027,
    'every standalone FY2027 donation should be moved in';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000003') = v_2026,
    'a standalone FY2026 donation should be moved into FY2026''s Donations group';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000004') is null,
    'a standalone work expense should be left alone';
  assert (select count(*) from public.deduction
    where updated_at = '2020-01-01'::timestamptz and id = 'bbbb0000-0000-0000-0000-000000000004') = 1,
    'the work expense row should be physically untouched';
end $$;

-- Idempotency: a second pass rewrites no row.
create temp table deduction_versions as select id, ctid as row_version from public.deduction;

\ir :MIGRATION

do $$ begin
  assert not exists (
    select 1 from public.deduction d join deduction_versions v using (id)
    where d.ctid <> v.row_version),
    'a second run of the backfill should rewrite no row';
end $$;

rollback;
