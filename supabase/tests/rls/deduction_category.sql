-- Assertions for a deduction's category and its interaction with work-use
-- apportioning.
--
-- `category` defaults to `work_expense`, matching existing behaviour for every
-- deduction written before the column existed. `deduction_work_use_basis` pins
-- `work_use_percent` to 100 for every non-`work_expense` category, exactly as
-- it already pins a distance-basis claim: a donation and a tax agent fee are
-- claimed in full or not at all, never apportioned. `deduction_distance_basis_work_expense`
-- goes further and refuses the `distance` basis outright for them — the ATO
-- cents-per-km method is a work-related travel deduction, and the add form
-- offers the dollar/distance toggle for a work expense alone.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'category@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000008","email":"category@example.com"}', true);
select public.create_household('Givers', 'Robin') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

-- An unqualified insert defaults to work_expense, backward compatible with
-- every deduction written before this column existed.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Union fees', 500_00, '2026-08-01', 2027)
  returning id as db_default \gset
select set_config('db.default', :'db_default', false);

do $$
begin
  assert (select category from public.deduction where id = current_setting('db.default')::uuid) = 'work_expense',
    'a deduction written without a category should default to work_expense';
end $$;

-- A donation claimed in full at 100% work use.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, full_amount_cents, work_use_percent)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Red Cross', 250_00, '2026-08-02', 2027, 'donation', 250_00, 100)
  returning id as db_donation \gset
select set_config('db.donation', :'db_donation', false);

do $$
begin
  assert (select amount_cents from public.deduction where id = current_setting('db.donation')::uuid) = 250_00,
    'a donation claimed at 100%% work use should save its full amount';
end $$;

do $$
declare v_hid uuid := current_setting('db.hid')::uuid;
        v_mid uuid := current_setting('db.mid')::uuid;
begin
  -- A donation is claimed in full or not at all: it cannot carry a work-use
  -- percent below 100.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Partial donation', 60_00, '2026-08-03', 2027, 'donation', 100_00, 60);
    raise exception 'FAIL: a donation was saved with a work-use percent below 100';
  exception when check_violation then
    raise notice 'PASS: a donation is pinned at 100%% work use';
  end;

  -- Tax agent fees are the same: claimed in full, never apportioned.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Partial fee', 40_00, '2026-08-04', 2027, 'tax_agent_fees', 80_00, 50);
    raise exception 'FAIL: a tax agent fee was saved with a work-use percent below 100';
  exception when check_violation then
    raise notice 'PASS: tax agent fees are pinned at 100%% work use';
  end;

  -- A work expense keeps apportioning by work use, unaffected by the new column.
  insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, full_amount_cents, work_use_percent)
    values (v_hid, v_mid, 'Phone plan', 60_00, '2026-08-05', 2027, 'work_expense', 100_00, 60);

  -- The distance basis is the ATO cents-per-km car method: a work-related
  -- travel deduction. deduction_distance_basis_work_expense refuses it for a
  -- donation or a tax agent fee even when work_use_percent stays 100.
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, basis, distance_km, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Charity drive', 91_00, '2026-08-06', 2027, 'donation', 'distance', 100, 91_00, 100);
    raise exception 'FAIL: a donation was saved on the distance basis';
  exception when check_violation then
    raise notice 'PASS: the distance basis is refused for a donation';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, basis, distance_km, full_amount_cents, work_use_percent)
      values (v_hid, v_mid, 'Trip to the accountant', 91_00, '2026-08-07', 2027, 'tax_agent_fees', 'distance', 100, 91_00, 100);
    raise exception 'FAIL: a tax agent fee was saved on the distance basis';
  exception when check_violation then
    raise notice 'PASS: the distance basis is refused for a tax agent fee';
  end;

  -- A work expense on the distance basis is still fine.
  insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, category, basis, distance_km, full_amount_cents, work_use_percent)
    values (v_hid, v_mid, 'Client visits', 91_00, '2026-08-08', 2027, 'work_expense', 'distance', 100, 91_00, 100);
end $$;

-- The add path carries the category too: create_deduction_with_receipts names
-- the column explicitly, so it has to be among them or a donation added from
-- the form would silently save as work_expense.
select public.create_deduction_with_receipts(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Salvation Army',
    'amount_cents', 100_00,
    'deduction_date', '2026-08-06',
    'financial_year', 2027,
    'category', 'donation',
    'full_amount_cents', 100_00,
    'work_use_percent', 100
  ),
  '[]'::jsonb
) as db_added \gset
select set_config('db.added', :'db_added', false);

do $$
begin
  assert (select category from public.deduction where id = current_setting('db.added')::uuid) = 'donation',
    'the RPC should carry the category it is given';
end $$;

-- A payload naming no category at all still succeeds, defaulting to
-- work_expense exactly as a direct insert does.
select public.create_deduction_with_receipts(
  jsonb_build_object(
    'household_id', current_setting('db.hid')::uuid,
    'member_id', current_setting('db.mid')::uuid,
    'description', 'Union fees',
    'amount_cents', 500_00,
    'deduction_date', '2026-08-07',
    'financial_year', 2027
  ),
  '[]'::jsonb
) as db_unqualified \gset
select set_config('db.unqualified', :'db_unqualified', false);

do $$
begin
  assert (select category from public.deduction where id = current_setting('db.unqualified')::uuid) = 'work_expense',
    'the RPC should default category to work_expense when the payload omits it';
end $$;

rollback;
