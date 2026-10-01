-- Assertions for share and ETF trades.
--
-- A trade is a member's buy or sell, keyed by `source` and `external_id` exactly
-- as `transactions` is so a later brokerage import can upsert without
-- duplicating. This file exercises the column constraints, the (source,
-- external_id) uniqueness, and the service_role read the EOFY share view uses;
-- household isolation lives in rls_isolation.sql.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'trade-ada@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","email":"trade-ada@example.com"}', true);
select public.create_household('Trade Household', 'Ada') as hid \gset
select set_config('tr.hid', :'hid', false);
select id as mid from public.members where household_id = current_setting('tr.hid')::uuid \gset
select set_config('tr.mid', :'mid', false);

-- A hand-entered trade defaults to the manual source with no external id, and a
-- zero fee.
insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
  values (current_setting('tr.hid')::uuid, current_setting('tr.mid')::uuid, 'VAS', 'buy', '2026-01-10', 10.5, 98_500_000);

do $$ begin
  assert (select source from public.trade) = 'manual', 'a trade defaults to the manual source';
  assert (select external_id from public.trade) is null, 'a manual trade has no external id';
  assert (select fee_cents from public.trade) = 0, 'a trade defaults to no brokerage';
  assert (select units from public.trade) = 10.5, 'fractional units round-trip';
end $$;

-- A price finer than a cent is held exactly, to six decimal places.
insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
  values (current_setting('tr.hid')::uuid, current_setting('tr.mid')::uuid, 'IOZ', 'buy', '2026-01-12', 2, 33_083_072);
do $$ begin
  assert (select price_per_unit_microdollars from public.trade where ticker = 'IOZ') = 33_083_072,
    'a partial-cent price round-trips exactly';
end $$;
delete from public.trade where ticker = 'IOZ';

-- Several manual trades coexist: a null external_id never collides.
insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
  values (current_setting('tr.hid')::uuid, current_setting('tr.mid')::uuid, 'VAS', 'sell', '2026-02-10', 5, 100_000_000);

do $$ begin
  assert (select count(*) from public.trade) = 2, 'manual trades with no external id coexist';
end $$;

do $$
declare
  v_hid uuid := current_setting('tr.hid')::uuid;
  v_mid uuid := current_setting('tr.mid')::uuid;
begin
  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
      values (v_hid, v_mid, 'vas', 'buy', '2026-01-10', 1, 1_000_000);
    raise exception 'FAIL: a lower-case ticker was saved';
  exception when check_violation then
    raise notice 'PASS: the ticker is stored upper-case';
  end;

  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
      values (v_hid, v_mid, '', 'buy', '2026-01-10', 1, 1_000_000);
    raise exception 'FAIL: an empty ticker was saved';
  exception when check_violation then
    raise notice 'PASS: the ticker cannot be empty';
  end;

  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
      values (v_hid, v_mid, 'VAS', 'buy', '2026-01-10', 0, 1_000_000);
    raise exception 'FAIL: a zero-unit trade was saved';
  exception when check_violation then
    raise notice 'PASS: units must be positive';
  end;

  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
      values (v_hid, v_mid, 'VAS', 'buy', '2026-01-10', 1, -1);
    raise exception 'FAIL: a negative price was saved';
  exception when check_violation then
    raise notice 'PASS: the price cannot be negative';
  end;

  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars, fee_cents)
      values (v_hid, v_mid, 'VAS', 'buy', '2026-01-10', 1, 1_00, -1);
    raise exception 'FAIL: a negative fee was saved';
  exception when check_violation then
    raise notice 'PASS: the fee cannot be negative';
  end;
end $$;

-- An imported trade is keyed by (source, external_id): a repeat is refused, and
-- an upsert on the key updates it in place.
insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars, source, external_id)
  values (current_setting('tr.hid')::uuid, current_setting('tr.mid')::uuid, 'NDQ', 'buy', '2026-03-01', 2, 40_000_000, 'redbark', 'rb-1');

do $$ begin
  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars, source, external_id)
      values (current_setting('tr.hid')::uuid, current_setting('tr.mid')::uuid, 'NDQ', 'buy', '2026-03-01', 2, 40_000_000, 'redbark', 'rb-1');
    raise exception 'FAIL: a duplicate (source, external_id) was saved';
  exception when unique_violation then
    raise notice 'PASS: (source, external_id) is unique';
  end;
end $$;

insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars, source, external_id)
  values (current_setting('tr.hid')::uuid, current_setting('tr.mid')::uuid, 'NDQ', 'buy', '2026-03-01', 3, 41_000_000, 'redbark', 'rb-1')
  on conflict (source, external_id) do update set units = excluded.units, price_per_unit_microdollars = excluded.price_per_unit_microdollars;

do $$ begin
  assert (select count(*) from public.trade where external_id = 'rb-1') = 1, 'an upsert on the key keeps one row';
  assert (select units from public.trade where external_id = 'rb-1') = 3, 'an upsert on the key updates the row';
end $$;

reset role;
set local role service_role;
do $$ begin
  assert (select count(*) from public.trade) = 3, 'service_role can read every trade (the EOFY share view)';
end $$;

rollback;
