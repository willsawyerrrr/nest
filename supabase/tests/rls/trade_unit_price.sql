-- Assertions for the migration that holds a trade's unit price exactly.
--
-- Rebuilds the shape the table had before — `price_per_unit_cents`, a bigint of
-- whole cents — loads trades of every kind into it, and runs the migration over
-- them. Every stored price must come out as the same value at the new scale (a
-- cent is 10,000 microdollars), no row may be touched (`updated_at` holds), the
-- non-negative constraint must survive, and a price finer than a cent must now
-- be storable and saved exactly through `create_trades_with_document`.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
\set UNIT_PRICE_MIGRATION ../../migrations/20261001040000_trade_exact_unit_price.sql
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tup-ada@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","email":"tup-ada@example.com"}', true);
select public.create_household('Price Household', 'Ada') as hid \gset
select set_config('tup.hid', :'hid', false);
select id as mid from public.members where household_id = current_setting('tup.hid')::uuid \gset
select set_config('tup.mid', :'mid', false);

-- ── The shape before the price was exact ──────────────────────────────────────

reset role;
alter table public.trade rename column price_per_unit_microdollars to price_per_unit_cents;
alter table public.trade rename constraint trade_price_per_unit_microdollars_check
  to trade_price_per_unit_cents_check;

insert into public.trade
    (id, household_id, member_id, ticker, side, traded_on, units, price_per_unit_cents, fee_cents)
  values
    ('84000000-0000-0000-0000-000000000001', current_setting('tup.hid')::uuid, current_setting('tup.mid')::uuid,
      'VAS', 'buy', '2026-01-10', 10.5, 98_50, 9_50),
    ('84000000-0000-0000-0000-000000000002', current_setting('tup.hid')::uuid, current_setting('tup.mid')::uuid,
      'VAS', 'sell', '2026-02-10', 5, 0, 0),
    ('84000000-0000-0000-0000-000000000003', current_setting('tup.hid')::uuid, current_setting('tup.mid')::uuid,
      'NDQ', 'buy', '2026-03-01', 0.000001, 1, 0),
    ('84000000-0000-0000-0000-000000000004', current_setting('tup.hid')::uuid, current_setting('tup.mid')::uuid,
      'NDQ', 'buy', '2026-03-02', 1234567.891234, 123_456_789_01, 1_00);

-- The update trigger would stamp the baseline with now(); pin it to a known time.
alter table public.trade disable trigger set_updated_at;
update public.trade set updated_at = '2026-01-01T00:00:00Z';
alter table public.trade enable trigger set_updated_at;

-- ── The migration ─────────────────────────────────────────────────────────────

\ir :UNIT_PRICE_MIGRATION

do $$ begin
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trade' and column_name = 'price_per_unit_cents'
  ), 'the whole-cent column is gone';
  assert (select price_per_unit_microdollars from public.trade where id = '84000000-0000-0000-0000-000000000001') = 98_500_000,
    '$98.50 is 98,500,000 microdollars';
  assert (select price_per_unit_microdollars from public.trade where id = '84000000-0000-0000-0000-000000000002') = 0,
    'a zero price stays zero';
  assert (select price_per_unit_microdollars from public.trade where id = '84000000-0000-0000-0000-000000000003') = 10_000,
    'one cent is 10,000 microdollars';
  assert (select price_per_unit_microdollars from public.trade where id = '84000000-0000-0000-0000-000000000004') = 123_456_789_010_000,
    'a large price converts without loss';
  assert (select count(*) from public.trade where updated_at <> '2026-01-01T00:00:00Z') = 0,
    'no trade row is touched';
  assert (select fee_cents from public.trade where id = '84000000-0000-0000-0000-000000000001') = 9_50,
    'fees stay in whole cents';
  assert (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'trade' and column_name = 'price_per_unit_microdollars') = 'bigint',
    'the price is an integer column';
end $$;

-- Every converted price is its old whole-cent value times 10,000, so a value in
-- cents is recovered exactly by dividing back.
do $$ begin
  assert (select bool_and(price_per_unit_microdollars % 10000 = 0) from public.trade),
    'migrated prices are whole cents at the new scale';
end $$;

-- ── The new column holds what the old could not ───────────────────────────────

do $$ begin
  begin
    insert into public.trade (household_id, member_id, ticker, side, traded_on, units, price_per_unit_microdollars)
      values (current_setting('tup.hid')::uuid, current_setting('tup.mid')::uuid, 'VAS', 'buy', '2026-01-10', 1, -1);
    raise exception 'FAIL: a negative price was saved';
  exception when check_violation then
    raise notice 'PASS: the price cannot be negative';
  end;
end $$;

set local role authenticated;
select set_config('tup.saved', public.create_trades_with_document(
  current_setting('tup.hid')::uuid,
  '85000000-0000-0000-0000-000000000001',
  current_setting('tup.hid') || '/85000000-0000-0000-0000-000000000001/note.pdf',
  jsonb_build_array(jsonb_build_object(
    'id', '84000000-0000-0000-0000-000000000005', 'member_id', current_setting('tup.mid'),
    'ticker', 'IOZ', 'side', 'buy', 'traded_on', '2024-10-25', 'units', 2,
    'price_per_unit_microdollars', 33_083_072, 'fee_cents', 2_00))
)::text, false);

do $$ begin
  assert current_setting('tup.saved')::integer = 1, 'the document trade is saved';
  assert (select price_per_unit_microdollars from public.trade where ticker = 'IOZ') = 33_083_072,
    'a partial-cent price is saved exactly';
end $$;

rollback;
