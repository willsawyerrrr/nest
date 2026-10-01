-- Assertions for the donations group.
--
-- A `donation` deduction written with no group of its own is filed into the
-- member's `donations`-kind deduction_group for its financial year by the
-- `file_donation_in_default_group` trigger, that group being created the first
-- time it is needed. Only donations can sit in that group and donations can sit
-- in no other; the group cannot be renamed, re-kinded, or deleted; and a group
-- the member names "Donations" is an ordinary group. This script proves those
-- on live writes, then rebuilds a pre-migration state and re-runs the migration
-- itself, asserting it flags, fills, and empties the groups correctly and
-- rewrites nothing on a second pass.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
\set MIGRATION ../../migrations/20260921000000_donations_only_group.sql
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

-- A donation with no group creates the member's donations group and lands in
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
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and kind = 'donations') = 1,
    'the first donation should create the member''s donations group for the year';
  assert (select name from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and kind = 'donations') = 'Donations',
    'the donations group should be named Donations';
  assert (select group_id from public.deduction where id = current_setting('db.d1')::uuid) = (
    select id from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2027 and kind = 'donations'),
    'the first donation should be filed into that group';
end $$;
select id as db_dg from public.deduction_group
  where household_id = current_setting('db.hid')::uuid and kind = 'donations' and financial_year = 2027 \gset
select set_config('db.dg', :'db_dg', false);

-- A second donation reuses the same group.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'MSF', 50_00, '2026-09-01', 2027, 'donation');

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
begin
  assert (select count(*) from public.deduction_group
    where household_id = v_hid and financial_year = 2027 and kind = 'donations') = 1,
    'a second donation should reuse the donations group, not create another';
  assert (select count(*) from public.deduction where group_id = current_setting('db.dg')::uuid) = 2,
    'both donations should sit in the donations group';
end $$;

-- A donation cannot be filed in a standard group, on insert or update.
insert into public.deduction_group (household_id, member_id, name, financial_year)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Local school fund', 2027)
  returning id as db_school \gset
select set_config('db.school', :'db_school', false);

do $$ begin
  assert (select kind from public.deduction_group where id = current_setting('db.school')::uuid) = 'standard',
    'a group a member creates should be standard by default';
end $$;

do $$ begin
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, group_id)
      values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'School raffle', 20_00, '2026-10-01', 2027, 'donation', current_setting('db.school')::uuid);
    raise exception 'a donation inserted into a standard group should be refused';
  exception when check_violation then null;
  end;
  begin
    update public.deduction set group_id = current_setting('db.school')::uuid where id = current_setting('db.d1')::uuid;
    raise exception 'a donation moved into a standard group should be refused';
  exception when check_violation then null;
  end;
end $$;

-- Clearing a donation's group snaps it back to the donations group.
update public.deduction set group_id = null where id = current_setting('db.d1')::uuid;

do $$ begin
  assert (select group_id from public.deduction where id = current_setting('db.d1')::uuid) = current_setting('db.dg')::uuid,
    'clearing a donation''s group should re-file it into the donations group';
end $$;

-- Only a donation can sit in the donations group, on insert or update.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Union fees', 500_00, '2026-08-01', 2027, 'work_expense')
  returning id as db_w \gset
select set_config('db.w', :'db_w', false);

do $$ begin
  assert (select group_id from public.deduction where id = current_setting('db.w')::uuid) is null,
    'a work expense with no group should stay standalone';
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, group_id)
      values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Agent', 200_00, '2026-08-01', 2027, 'tax_agent_fees', current_setting('db.dg')::uuid);
    raise exception 'a tax agent fee inserted into the donations group should be refused';
  exception when check_violation then null;
  end;
  begin
    update public.deduction set group_id = current_setting('db.dg')::uuid where id = current_setting('db.w')::uuid;
    raise exception 'a work expense moved into the donations group should be refused';
  exception when check_violation then null;
  end;
  begin
    update public.deduction set category = 'work_expense' where id = current_setting('db.d1')::uuid;
    raise exception 'a donation re-categorised while in the donations group should be refused';
  exception when check_violation then null;
  end;
end $$;

-- A work expense can still be filed into a standard group.
update public.deduction set group_id = current_setting('db.school')::uuid where id = current_setting('db.w')::uuid;

do $$ begin
  assert (select group_id from public.deduction where id = current_setting('db.w')::uuid) = current_setting('db.school')::uuid,
    'a work expense should be fileable into a standard group';
end $$;

-- A year with only work expenses has no donations group.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Laptop', 500_00, '2025-08-01', 2026, 'work_expense');

do $$ begin
  assert not exists (select 1 from public.deduction_group
    where household_id = current_setting('db.hid')::uuid and financial_year = 2026),
    'a year of only work expenses should have no donations group';
end $$;

-- A donation in a different year gets its own donations group.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Salvos', 30_00, '2025-09-01', 2026, 'donation');

do $$ begin
  assert (select count(*) from public.deduction_group
    where household_id = current_setting('db.hid')::uuid and kind = 'donations') = 2,
    'each financial year with a donation should get its own donations group';
end $$;

-- The add path files a donation into the donations group too:
-- create_deduction_with_receipt inserts into deduction, so the trigger fires.
select public.create_deduction_with_receipt(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Oxfam',
    'amount_cents', 25_00,
    'deduction_date', '2026-11-01',
    'financial_year', 2027,
    'category', 'donation'
  ),
  null
) as db_added \gset
select set_config('db.added', :'db_added', false);

do $$ begin
  assert (select group_id from public.deduction where id = current_setting('db.added')::uuid) = current_setting('db.dg')::uuid,
    'a donation added through the RPC should be filed into the donations group';
end $$;

-- ── The donations group is fixed ─────────────────────────────────────────────

do $$ begin
  begin
    update public.deduction_group set name = 'Charity' where id = current_setting('db.dg')::uuid;
    raise exception 'renaming the donations group should be refused';
  exception when check_violation then null;
  end;
  begin
    update public.deduction_group set kind = 'standard' where id = current_setting('db.dg')::uuid;
    raise exception 'turning the donations group into a standard one should be refused';
  exception when check_violation then null;
  end;
  begin
    update public.deduction_group set kind = 'donations' where id = current_setting('db.school')::uuid;
    raise exception 'turning a standard group into a donations one should be refused';
  exception when check_violation then null;
  end;
end $$;

-- A standard group can be renamed, and one named "Donations" is still standard.
update public.deduction_group set name = 'Donations' where id = current_setting('db.school')::uuid;

do $$ begin
  assert (select kind from public.deduction_group where id = current_setting('db.school')::uuid) = 'standard',
    'a group named Donations by the member should be a standard group';
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, group_id)
      values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Gift', 5_00, '2026-10-01', 2027, 'donation', current_setting('db.school')::uuid);
    raise exception 'a donation should not be fileable into a standard group named Donations';
  exception when check_violation then null;
  end;
end $$;

-- A second donations group for the same member and year is refused.
do $$ begin
  begin
    insert into public.deduction_group (household_id, member_id, name, financial_year, kind)
      values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'More donations', 2027, 'donations');
    raise exception 'a second donations group for a member and year should be refused';
  exception when unique_violation then null;
  end;
end $$;

-- The donations group cannot be deleted by a member; a standard group can.
delete from public.deduction_group where id = current_setting('db.dg')::uuid;
delete from public.deduction_group where id = current_setting('db.school')::uuid;

do $$ begin
  assert exists (select 1 from public.deduction_group where id = current_setting('db.dg')::uuid),
    'the donations group should survive a delete';
  assert not exists (select 1 from public.deduction_group where id = current_setting('db.school')::uuid),
    'a standard group should be deletable';
  assert (select group_id from public.deduction where id = current_setting('db.w')::uuid) is null,
    'deleting a standard group should ungroup its payments';
end $$;

-- ── The migration, run against pre-migration data ───────────────────────────
--
-- The pre-migration state — donations in named groups or none, a non-donation
-- in a group called "Donations", duplicate "Donations" groups — is built with
-- the triggers off and as the table's owner rather than a member. A separate
-- auth user owns this household so the first user is never in two.
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-00000000000a","email":"backfill@example.com"}', true);
select public.create_household('Backfillers', 'Alex') as bf_hid \gset
select set_config('bf.hid', :'bf_hid', false);
select id as bf_mid from public.members where household_id = current_setting('bf.hid')::uuid \gset
select set_config('bf.mid', :'bf_mid', false);

reset role;
alter table public.deduction disable trigger file_donation_in_default_group;

insert into public.deduction_group (id, household_id, member_id, name, financial_year, created_at)
  values
    -- FY2027: the automatic group, holding a donation and a work expense.
    ('bbbb1111-0000-0000-0000-000000000001', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Donations', 2027, '2020-01-02'),
    -- FY2027: a named group holding a donation.
    ('bbbb1111-0000-0000-0000-000000000002', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Charity', 2027, '2020-01-03'),
    -- FY2025: two groups named "Donations"; only the second holds a donation.
    ('bbbb1111-0000-0000-0000-000000000003', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Donations', 2025, '2020-01-02'),
    ('bbbb1111-0000-0000-0000-000000000004', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Donations', 2025, '2020-01-03');

-- `updated_at` is seeded to a date no write in this transaction can produce, so
-- a row the migration skips is provably untouched.
insert into public.deduction
    (id, household_id, member_id, description, amount_cents, deduction_date, financial_year, category, full_amount_cents, work_use_percent, group_id, updated_at)
  values
    ('bbbb0000-0000-0000-0000-000000000001', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'RSPCA', 40_00, '2026-08-01', 2027, 'donation', 40_00, 100, 'bbbb1111-0000-0000-0000-000000000001', '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000002', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Beyond Blue', 60_00, '2026-09-01', 2027, 'donation', 60_00, 100, 'bbbb1111-0000-0000-0000-000000000002', '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000003', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Cancer Council', 15_00, '2025-08-01', 2026, 'donation', 15_00, 100, null, '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000004', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Laptop', 900_00, '2026-08-01', 2027, 'work_expense', 900_00, 100, 'bbbb1111-0000-0000-0000-000000000001', '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000005', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Phone', 300_00, '2025-08-01', 2026, 'work_expense', 300_00, 100, null, '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000006', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Red Nose', 10_00, '2024-08-01', 2025, 'donation', 10_00, 100, 'bbbb1111-0000-0000-0000-000000000004', '2020-01-01'),
    ('bbbb0000-0000-0000-0000-000000000007', current_setting('bf.hid')::uuid, current_setting('bf.mid')::uuid, 'Standalone gift', 5_00, '2026-10-01', 2027, 'donation', 5_00, 100, null, '2020-01-01');

alter table public.deduction enable trigger file_donation_in_default_group;

\ir :MIGRATION

do $$
declare v_hid uuid := current_setting('bf.hid')::uuid;
        v_mid uuid := current_setting('bf.mid')::uuid;
        v_2026 uuid;
begin
  select id into v_2026 from public.deduction_group
    where household_id = v_hid and member_id = v_mid and financial_year = 2026 and kind = 'donations';

  assert (select kind from public.deduction_group where id = 'bbbb1111-0000-0000-0000-000000000001') = 'donations',
    'the existing FY2027 Donations group should be flagged';
  assert (select kind from public.deduction_group where id = 'bbbb1111-0000-0000-0000-000000000002') = 'standard',
    'a named group should stay standard';
  assert (select kind from public.deduction_group where id = 'bbbb1111-0000-0000-0000-000000000004') = 'donations',
    'of two Donations groups, the one holding donations should be flagged';
  assert (select kind from public.deduction_group where id = 'bbbb1111-0000-0000-0000-000000000003') = 'standard',
    'of two Donations groups, the empty one should stay standard';
  assert v_2026 is not null,
    'a year with only an ungrouped donation should get a donations group';
  assert (select count(*) from public.deduction_group
    where household_id = v_hid and kind = 'donations') = 3,
    'the migration should leave exactly one donations group per year that needs one';

  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000001') = 'bbbb1111-0000-0000-0000-000000000001',
    'a donation already in the donations group should stay there';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000002') = 'bbbb1111-0000-0000-0000-000000000001',
    'a donation in a named group should move into the donations group';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000003') = v_2026,
    'an ungrouped donation should move into its year''s donations group';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000007') = 'bbbb1111-0000-0000-0000-000000000001',
    'every ungrouped donation of the year should move in';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000006') = 'bbbb1111-0000-0000-0000-000000000004',
    'a donation in the flagged group of a duplicate pair should stay in it';
  assert (select group_id from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000004') is null,
    'a work expense in the donations group should be moved out of it';
  assert (select updated_at from public.deduction where id = 'bbbb0000-0000-0000-0000-000000000005') = '2020-01-01'::timestamptz,
    'an ungrouped work expense should be physically untouched';
end $$;

-- Idempotency: a second pass rewrites no row.
create temp table deduction_versions as select id, ctid as row_version from public.deduction;
create temp table deduction_group_versions as select id, ctid as row_version from public.deduction_group;

\ir :MIGRATION

do $$ begin
  assert not exists (
    select 1 from public.deduction d join deduction_versions v using (id)
    where d.ctid <> v.row_version),
    'a second run of the migration should rewrite no deduction';
  assert not exists (
    select 1 from public.deduction_group g join deduction_group_versions v using (id)
    where g.ctid <> v.row_version),
    'a second run of the migration should rewrite no group';
end $$;

rollback;
