-- Assertions for the `hours` deduction basis: the ATO's fixed rate method for
-- working from home.
--
-- A deduction on the `hours` basis states `work_from_home_hours`; the client
-- prices it at the financial year's cents-per-hour rate before writing, so
-- `amount_cents` is stored as sent and never re-derived here. The pairing
-- constraint holds each basis to its own column, the basis is restricted to
-- work expenses, pinned at 100% work use, and fixed once saved.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000014', 'authenticated', 'authenticated', 'homeworker@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000014","email":"homeworker@example.com"}', true);
select public.create_household('Homeworkers', 'Hana') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

do $$
declare
  v_hid uuid := current_setting('db.hid')::uuid;
  v_mid uuid := current_setting('db.mid')::uuid;
begin
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis)
      values (v_hid, v_mid, 'Home office', 84_00, '2026-08-02', 2027, 'hours');
    raise exception 'FAIL: an hours-basis deduction was saved with no hours';
  exception when check_violation then
    raise notice 'PASS: an hours-basis deduction must name its hours';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, work_from_home_hours)
      values (v_hid, v_mid, 'Home office', 84_00, '2026-08-02', 2027, 'hours', -1);
    raise exception 'FAIL: negative hours were saved';
  exception when check_violation then
    raise notice 'PASS: work_from_home_hours cannot be negative';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, work_from_home_hours, distance_km)
      values (v_hid, v_mid, 'Home office', 84_00, '2026-08-02', 2027, 'hours', 120, 10);
    raise exception 'FAIL: an hours-basis deduction was saved with a distance';
  exception when check_violation then
    raise notice 'PASS: an hours-basis deduction carries no distance';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, distance_km, work_from_home_hours)
      values (v_hid, v_mid, 'Client visits', 91_00, '2026-08-02', 2027, 'distance', 100, 5);
    raise exception 'FAIL: a distance-basis deduction was saved with hours';
  exception when check_violation then
    raise notice 'PASS: a distance-basis deduction carries no hours';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, work_from_home_hours)
      values (v_hid, v_mid, 'Tools', 350_00, '2026-08-03', 2027, 'amount', 5);
    raise exception 'FAIL: an amount-basis deduction was saved with hours';
  exception when check_violation then
    raise notice 'PASS: an amount-basis deduction carries no hours';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, basis, work_from_home_hours, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Charity drive', 84_00, '2026-08-06', 2027, 'donation', 'hours', 120, 84_00, 100);
    raise exception 'FAIL: a donation was saved on the hours basis';
  exception when check_violation then
    raise notice 'PASS: the hours basis is refused for a donation';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, basis, work_from_home_hours, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Tax agent', 84_00, '2026-08-07', 2027, 'tax_agent_fees', 'hours', 120, 84_00, 100);
    raise exception 'FAIL: a tax agent fee was saved on the hours basis';
  exception when check_violation then
    raise notice 'PASS: the hours basis is refused for a tax agent fee';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, work_from_home_hours, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Home office', 42_00, '2026-08-09', 2027, 'hours', 120, 84_00, 50);
    raise exception 'FAIL: an hours-basis deduction was saved with a work-use percent below 100';
  exception when check_violation then
    raise notice 'PASS: an hours-basis deduction is pinned at 100%% work use';
  end;
end $$;

-- A valid hours-basis row: amount_cents is whatever the client computed and
-- sent (120 hours at 70c/hour = $84.00), the database not re-deriving it.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, work_from_home_hours)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Home office', 84_00, '2026-08-02', 2027, 'hours', 120)
  returning id as db_hours \gset
select set_config('db.hours', :'db_hours', false);

do $$
declare v_id uuid := current_setting('db.hours')::uuid;
begin
  assert (select basis from public.deduction where id = v_id) = 'hours',
    'the hours-basis deduction should record its basis';
  assert (select work_from_home_hours from public.deduction where id = v_id) = 120,
    'the hours-basis deduction should record its hours';
  assert (select amount_cents from public.deduction where id = v_id) = 84_00,
    'amount_cents should be the figure the client computed and sent';
  assert (select full_amount_cents from public.deduction where id = v_id) = 84_00,
    'full_amount_cents should be filled from amount_cents';
end $$;

-- The basis is fixed once saved; an update leaving it alone still succeeds.
do $$
declare v_id uuid := current_setting('db.hours')::uuid;
begin
  begin
    update public.deduction set basis = 'amount', work_from_home_hours = null where id = v_id;
    raise exception 'FAIL: an hours-basis deduction''s basis was changed';
  exception when check_violation then
    raise notice 'PASS: an hours-basis deduction''s basis cannot be changed';
  end;

  update public.deduction set description = 'Study', work_from_home_hours = 130, amount_cents = 91_00, full_amount_cents = 91_00 where id = v_id;
  assert (select work_from_home_hours from public.deduction where id = v_id) = 130,
    'the hours of an hours-basis deduction should be editable';
end $$;

-- The add path carries the hours: create_deduction_with_receipt names the
-- column explicitly, so it has to be among them.
select public.create_deduction_with_receipt(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Home office',
    'amount_cents', 70_00,
    'deduction_date', '2026-08-10',
    'financial_year', 2027,
    'basis', 'hours',
    'work_from_home_hours', 100,
    'full_amount_cents', 70_00,
    'work_use_percent', 100
  ),
  null
) as db_added \gset
select set_config('db.added', :'db_added', false);

do $$
declare v_id uuid := current_setting('db.added')::uuid;
begin
  assert (select basis from public.deduction where id = v_id) = 'hours',
    'the RPC should carry the basis it is given';
  assert (select work_from_home_hours from public.deduction where id = v_id) = 100,
    'the RPC should carry the hours it is given';
end $$;

rollback;
