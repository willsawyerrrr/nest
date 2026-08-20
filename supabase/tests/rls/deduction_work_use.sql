-- Assertions for a deduction's work-use apportioning.
--
-- A deduction claimed at less than the whole cost states `full_amount_cents`
-- (what it cost) and `work_use_percent` (the share claimed), and
-- `amount_cents` — the figure every reader uses — must be exactly that
-- percentage of that cost, rounded to the nearest cent:
-- `deduction_work_use_apportioned`. `deduction_work_use_range` bounds the
-- percentage to (0, 100] and the full cost to non-negative.
-- `deduction_work_use_basis` pins the percentage at 100 on the distance basis,
-- whose kilometres are work-related already, so a percentage on top would
-- discount the claim twice.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'workuse@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000007","email":"workuse@example.com"}', true);
select public.create_household('Freelancers', 'Sam') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

-- An unqualified insert is claimed in full — full_amount_cents defaults to
-- amount_cents and work_use_percent defaults to 100.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Union fees', 500_00, '2026-08-01', 2027)
  returning id as db_full \gset
select set_config('db.full', :'db_full', false);

do $$
declare v_id uuid := current_setting('db.full')::uuid;
begin
  assert (select work_use_percent from public.deduction where id = v_id) = 100,
    'a deduction written without a work-use percent should default to 100';
  assert (select full_amount_cents from public.deduction where id = v_id) = 500_00,
    'a deduction written without a full amount should default to amount_cents';
end $$;

-- A part-private phone plan: $100 a month at 60% work use is a $60 claim.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, full_amount_cents, work_use_percent)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Phone plan', 60_00, '2026-08-05', 2027, 100_00, 60)
  returning id as db_apportioned \gset
select set_config('db.apportioned', :'db_apportioned', false);

do $$
declare v_id uuid := current_setting('db.apportioned')::uuid;
begin
  assert (select amount_cents from public.deduction where id = v_id) = 60_00,
    'a part-private deduction should record the apportioned amount';
end $$;

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
begin
  -- amount_cents disagreeing with full_amount_cents * work_use_percent / 100.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Wrong maths', 50_00, '2026-08-06', 2027, 100_00, 60);
    raise exception 'FAIL: amount_cents disagreeing with the apportioning was saved';
  exception when check_violation then
    raise notice 'PASS: amount_cents must equal the apportioned figure';
  end;

  -- work_use_percent of 0 is not a deduction at all — it should be deleted, not
  -- claimed at nothing.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Zero use', 0, '2026-08-07', 2027, 100_00, 0);
    raise exception 'FAIL: a zero work-use percent was saved';
  exception when check_violation then
    raise notice 'PASS: work_use_percent must be greater than zero';
  end;

  -- work_use_percent above 100 would claim more than the expense cost.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Over-claimed', 150_00, '2026-08-08', 2027, 100_00, 150);
    raise exception 'FAIL: a work-use percent above 100 was saved';
  exception when check_violation then
    raise notice 'PASS: work_use_percent must not exceed 100';
  end;

  -- A distance-basis row cannot carry a work-use percent below 100: its
  -- kilometres are work-related already.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, distance_km, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Client visits', 45_50, '2026-08-09', 2027, 'distance', 50, 91_00, 50);
    raise exception 'FAIL: a distance-basis deduction was saved with a work-use percent below 100';
  exception when check_violation then
    raise notice 'PASS: a distance-basis deduction is pinned at 100%% work use';
  end;
end $$;

-- The add path apportions too: create_deduction_with_receipts names both
-- columns explicitly, so they have to be among them or a work-use claim added
-- from the form would fail the apportioning constraint outright.
select public.create_deduction_with_receipts(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Software licence',
    'amount_cents', 40_00,
    'deduction_date', '2026-08-10',
    'financial_year', 2027,
    'full_amount_cents', 80_00,
    'work_use_percent', 50
  ),
  '[]'::jsonb
) as db_added \gset
select set_config('db.added', :'db_added', false);

do $$
declare v_added uuid := current_setting('db.added')::uuid;
begin
  assert (select amount_cents from public.deduction where id = v_added) = 40_00,
    'the RPC should carry the work-use apportioning it is given';
  assert (select full_amount_cents from public.deduction where id = v_added) = 80_00,
    'the RPC should record the full cost behind the claim';
end $$;

-- A payload naming no work-use figures at all still satisfies the apportioning
-- constraint: full_amount_cents has no plain column default, so this exercises
-- snapshot_deduction_full_amount through the RPC's insert, not just a direct one.
select public.create_deduction_with_receipts(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Union fees',
    'amount_cents', 500_00,
    'deduction_date', '2026-08-11',
    'financial_year', 2027
  ),
  '[]'::jsonb
) as db_unqualified \gset
select set_config('db.unqualified', :'db_unqualified', false);

do $$
declare v_id uuid := current_setting('db.unqualified')::uuid;
begin
  assert (select full_amount_cents from public.deduction where id = v_id) = 500_00,
    'the RPC should default full_amount_cents to amount_cents through the trigger, not just a direct insert';
  assert (select work_use_percent from public.deduction where id = v_id) = 100,
    'the RPC should default work_use_percent to 100 when the payload omits it';
end $$;

rollback;
