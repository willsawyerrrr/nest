-- Assertions for equity option exercises and sales.
--
-- An exercise converts options into shares at the grant's strike; a sale sells
-- shares. This file exercises the column constraints, the strike snapshot, the
-- quantity guards (only options are exercised, exercised units cannot exceed the
-- grant, sold units cannot exceed what is held — checked on every change to a
-- grant, exercise, or sale), the cascade from a grant, household isolation, and
-- the service_role read the EOFY share view uses.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'eq-ada@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'eq-bo@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","email":"eq-ada@example.com"}', true);
select public.create_household('Equity Household', 'Ada') as hid \gset
select set_config('eq.hid', :'hid', false);
select id as mid from public.members where household_id = current_setting('eq.hid')::uuid \gset
select set_config('eq.mid', :'mid', false);

insert into public.equity_grant
  (household_id, member_id, label, instrument_type, quantity, grant_date, strike_price_cents, price_per_share_cents)
  values (current_setting('eq.hid')::uuid, current_setting('eq.mid')::uuid, 'Options', 'option', 1000, '2024-01-15', 50, 3_00)
  returning id as oid \gset
select set_config('eq.oid', :'oid', false);
insert into public.equity_grant
  (household_id, member_id, label, instrument_type, quantity, grant_date, price_per_share_cents)
  values (current_setting('eq.hid')::uuid, current_setting('eq.mid')::uuid, 'Shares', 'share', 200, '2024-01-15', 3_00)
  returning id as sid \gset
select set_config('eq.sid', :'sid', false);

-- An exercise left without a strike snapshots the grant's; an explicit one is kept.
insert into public.equity_exercise (household_id, member_id, grant_id, exercised_on, quantity)
  values (current_setting('eq.hid')::uuid, current_setting('eq.mid')::uuid, current_setting('eq.oid')::uuid, '2025-02-01', 400);
do $$ begin
  assert (select strike_price_cents from public.equity_exercise) = 50, 'the strike is snapshotted from the grant';
  assert (select market_price_per_share_cents from public.equity_exercise) is null, 'the market price is optional';
end $$;
update public.equity_grant set strike_price_cents = 60 where id = current_setting('eq.oid')::uuid;
do $$ begin
  assert (select strike_price_cents from public.equity_exercise) = 50, 'a later strike edit leaves a recorded exercise alone';
end $$;

-- A sale defaults to no fee.
insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
  values (current_setting('eq.hid')::uuid, current_setting('eq.mid')::uuid, current_setting('eq.oid')::uuid, '2025-06-01', 100, 3_00);
do $$ begin
  assert (select fee_cents from public.equity_sale) = 0, 'a sale defaults to no fee';
end $$;

do $$
declare
  v_hid uuid := current_setting('eq.hid')::uuid;
  v_mid uuid := current_setting('eq.mid')::uuid;
  v_oid uuid := current_setting('eq.oid')::uuid;
  v_sid uuid := current_setting('eq.sid')::uuid;
begin
  begin
    insert into public.equity_exercise (household_id, member_id, grant_id, exercised_on, quantity)
      values (v_hid, v_mid, v_oid, '2025-02-01', 0);
    raise exception 'FAIL: a zero-quantity exercise was saved';
  exception when check_violation then
    raise notice 'PASS: an exercise quantity must be positive';
  end;

  begin
    insert into public.equity_exercise (household_id, member_id, grant_id, exercised_on, quantity, market_price_per_share_cents)
      values (v_hid, v_mid, v_oid, '2025-02-01', 1, -1);
    raise exception 'FAIL: a negative market price was saved';
  exception when check_violation then
    raise notice 'PASS: the market price cannot be negative';
  end;

  begin
    insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
      values (v_hid, v_mid, v_oid, '2025-06-01', 0, 1_00);
    raise exception 'FAIL: a zero-quantity sale was saved';
  exception when check_violation then
    raise notice 'PASS: a sale quantity must be positive';
  end;

  begin
    insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents, fee_cents)
      values (v_hid, v_mid, v_oid, '2025-06-01', 1, 1_00, -1);
    raise exception 'FAIL: a negative fee was saved';
  exception when check_violation then
    raise notice 'PASS: the fee cannot be negative';
  end;

  -- Only an option grant takes an exercise.
  begin
    insert into public.equity_exercise (household_id, member_id, grant_id, exercised_on, quantity)
      values (v_hid, v_mid, v_sid, '2025-02-01', 1);
    raise exception 'FAIL: a share grant was exercised';
  exception when check_violation then
    assert sqlerrm = 'equity_exercise_not_option', 'the refusal must be the fixed equity_exercise_not_option message';
    raise notice 'PASS: only options are exercised';
  end;

  -- Exercised units cannot exceed the grant: 400 exercised of 1,000.
  begin
    insert into public.equity_exercise (household_id, member_id, grant_id, exercised_on, quantity)
      values (v_hid, v_mid, v_oid, '2025-03-01', 601);
    raise exception 'FAIL: more options were exercised than granted';
  exception when check_violation then
    assert sqlerrm = 'equity_exercise_exceeds_grant', 'the refusal must be the fixed equity_exercise_exceeds_grant message';
    raise notice 'PASS: exercises cannot exceed the grant';
  end;

  -- Sold units cannot exceed exercised units for an option grant: 100 sold of 400.
  begin
    insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
      values (v_hid, v_mid, v_oid, '2025-07-01', 301, 3_00);
    raise exception 'FAIL: more options were sold than exercised';
  exception when check_violation then
    assert sqlerrm = 'equity_sale_exceeds_holding', 'the refusal must be the fixed equity_sale_exceeds_holding message';
    raise notice 'PASS: sales cannot exceed what is exercised';
  end;

  -- A share grant sells against its own quantity.
  begin
    insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
      values (v_hid, v_mid, v_sid, '2025-07-01', 201, 3_00);
    raise exception 'FAIL: more shares were sold than granted';
  exception when check_violation then
    raise notice 'PASS: share sales cannot exceed the grant';
  end;

  -- Exactly what is exercised may be sold; the guards bind edits and deletes too.
  insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
    values (v_hid, v_mid, v_oid, '2025-07-01', 300, 3_00);
  insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
    values (v_hid, v_mid, v_sid, '2025-07-01', 200, 3_00);

  begin
    update public.equity_sale set quantity = 301 where sold_on = '2025-07-01' and grant_id = v_oid;
    raise exception 'FAIL: a sale was edited past what is held';
  exception when check_violation then
    raise notice 'PASS: editing a sale is held to what is exercised';
  end;

  begin
    delete from public.equity_exercise where grant_id = v_oid;
    raise exception 'FAIL: an exercise holding sold shares was deleted';
  exception when check_violation then
    raise notice 'PASS: deleting an exercise cannot strand a sale';
  end;

  begin
    update public.equity_exercise set quantity = 399 where grant_id = v_oid;
    raise exception 'FAIL: an exercise was shrunk below what was sold';
  exception when check_violation then
    raise notice 'PASS: shrinking an exercise cannot strand a sale';
  end;

  begin
    update public.equity_grant set quantity = 399 where id = v_oid;
    raise exception 'FAIL: a grant was shrunk below what was exercised';
  exception when check_violation then
    raise notice 'PASS: shrinking a grant is held to what is exercised';
  end;

  begin
    update public.equity_grant set instrument_type = 'share' where id = v_oid;
    raise exception 'FAIL: an exercised grant became shares';
  exception when check_violation then
    raise notice 'PASS: an exercised grant stays options';
  end;
end $$;

-- A second household sees none of it and cannot write against its grants.
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","email":"eq-bo@example.com"}', true);
select public.create_household('Other Household', 'Bo') as hid2 \gset
select id as mid2 from public.members where household_id = :'hid2'::uuid \gset
do $$ begin
  assert (select count(*) from public.equity_exercise) = 0, 'another household sees no exercises';
  assert (select count(*) from public.equity_sale) = 0, 'another household sees no sales';
  begin
    insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
      values (current_setting('eq.hid')::uuid, current_setting('eq.mid')::uuid, current_setting('eq.sid')::uuid, '2025-08-01', 1, 1_00);
    raise exception 'FAIL: a sale was written into another household';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-household writes are refused';
  end;
end $$;
do $$ begin
  begin
    insert into public.equity_sale (household_id, member_id, grant_id, sold_on, quantity, price_per_share_cents)
      values (current_setting('eq.hid')::uuid, (select id from public.members limit 1), current_setting('eq.sid')::uuid, '2025-08-01', 1, 1_00);
    raise exception 'FAIL: a sale was written against another household''s grant';
  exception when insufficient_privilege or foreign_key_violation then
    raise notice 'PASS: a sale cannot reference another household';
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","email":"eq-ada@example.com"}', true);

reset role;
set local role service_role;
do $$ begin
  assert (select count(*) from public.equity_grant) = 2, 'service_role can read every grant (the EOFY share view)';
  assert (select count(*) from public.equity_exercise) = 1, 'service_role can read every exercise (the EOFY share view)';
  assert (select count(*) from public.equity_sale) = 3, 'service_role can read every sale (the EOFY share view)';
end $$;

-- Deleting a grant removes its exercises and sales, whatever order they cascade in.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","email":"eq-ada@example.com"}', true);
delete from public.equity_grant where id = current_setting('eq.oid')::uuid;
do $$ begin
  assert (select count(*) from public.equity_exercise) = 0, 'deleting a grant removes its exercises';
  assert (select count(*) from public.equity_sale) = 1, 'deleting a grant removes its sales';
end $$;

rollback;
