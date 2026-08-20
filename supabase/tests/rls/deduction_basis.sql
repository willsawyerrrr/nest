-- Assertions for a deduction's amount/distance basis.
--
-- A deduction states its `basis`: the default `amount`, entered directly, or
-- `distance`, entered as `distance_km` kilometres for a work-related car expense
-- claimed under the ATO's cents-per-kilometre method. `amount_cents` is always
-- the figure that is saved and read downstream — the client computes it from
-- `distance_km` before writing a distance-basis row — and the
-- `deduction_basis_attribution` check constraint holds each basis to its own
-- column, mirroring `payslip_line_kind_attribution`.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'deductions@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000004","email":"deductions@example.com"}', true);
select public.create_household('Commuters', 'Dana') as db_hid \gset
select set_config('db.hid', :'db_hid', false);
select id as db_mid from public.members where household_id = current_setting('db.hid')::uuid \gset
select set_config('db.mid', :'db_mid', false);

do $$ begin
  assert exists (
    select 1 from pg_constraint
    where conname = 'deduction_basis_attribution'
      and conrelid = 'public.deduction'::regclass),
    'the pairing constraint should hold each basis to its own column';
end $$;

-- An unqualified insert is the amount basis an unqualified deduction always was.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Union fees', 500_00, '2026-08-01', 2027)
  returning id as db_amount \gset
select set_config('db.amount', :'db_amount', false);

do $$
declare v_id uuid := current_setting('db.amount')::uuid;
begin
  assert (select basis from public.deduction where id = v_id) = 'amount',
    'a deduction written without a basis should default to amount';
  assert (select distance_km from public.deduction where id = v_id) is null,
    'an amount-basis deduction should carry no distance';
end $$;

do $$
declare
  v_hid uuid := current_setting('db.hid')::uuid;
  v_mid uuid := current_setting('db.mid')::uuid;
begin
  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis)
      values (v_hid, v_mid, 'Client visits', 91_00, '2026-08-02', 2027, 'distance');
    raise exception 'FAIL: a distance-basis deduction was saved with no distance';
  exception when check_violation then
    raise notice 'PASS: a distance-basis deduction must name its distance';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, distance_km)
      values (v_hid, v_mid, 'Client visits', 91_00, '2026-08-02', 2027, 'distance', -10);
    raise exception 'FAIL: a negative distance was saved';
  exception when check_violation then
    raise notice 'PASS: distance_km cannot be negative';
  end;

  begin
    insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, distance_km)
      values (v_hid, v_mid, 'Tools', 350_00, '2026-08-03', 2027, 'amount', 50);
    raise exception 'FAIL: an amount-basis deduction was saved with a distance';
  exception when check_violation then
    raise notice 'PASS: an amount-basis deduction carries no distance';
  end;
end $$;

-- A valid distance-basis row: amount_cents is whatever the client computed and
-- sent (100km at FY2027's 91c/km rate = $91.00), the database not re-deriving it.
insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, basis, distance_km)
  values (current_setting('db.hid')::uuid, current_setting('db.mid')::uuid, 'Client visits', 91_00, '2026-08-02', 2027, 'distance', 100)
  returning id as db_distance \gset
select set_config('db.distance', :'db_distance', false);

do $$
declare v_id uuid := current_setting('db.distance')::uuid;
begin
  assert (select basis from public.deduction where id = v_id) = 'distance',
    'the distance-basis deduction should record its basis';
  assert (select distance_km from public.deduction where id = v_id) = 100,
    'the distance-basis deduction should record its distance';
  assert (select amount_cents from public.deduction where id = v_id) = 91_00,
    'amount_cents should be the figure the client computed and sent';
end $$;

rollback;
