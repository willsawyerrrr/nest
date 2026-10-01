-- Assertions for the broker documents trades are read from.
--
-- One document backs several trades, saved together by
-- `create_trades_with_document`. This file exercises that function, the
-- household-scoped link, a retried save, and what deleting a document does to its
-- trades; the Storage policy on the `receipts` bucket is not available here.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tdoc-ada@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tdoc-bob@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","email":"tdoc-ada@example.com"}', true);
select public.create_household('Ada Household', 'Ada') as hid \gset
select set_config('td.hid', :'hid', false);
select id as mid from public.members where household_id = current_setting('td.hid')::uuid \gset
select set_config('td.mid', :'mid', false);

select set_config('td.payload', jsonb_build_array(
  jsonb_build_object('id', '82000000-0000-0000-0000-000000000001', 'member_id', current_setting('td.mid'),
    'ticker', 'VAS', 'side', 'buy', 'traded_on', '2026-01-10', 'units', 10.5,
    'price_per_unit_microdollars', 98_500_000, 'fee_cents', 9_50),
  jsonb_build_object('id', '82000000-0000-0000-0000-000000000002', 'member_id', current_setting('td.mid'),
    'ticker', 'VGS', 'side', 'sell', 'traded_on', '2026-01-11', 'units', 2,
    'price_per_unit_microdollars', 33_083_072)
)::text, false);

-- One document, two trades, one transaction.
select public.create_trades_with_document(
  current_setting('td.hid')::uuid,
  '83000000-0000-0000-0000-000000000001',
  current_setting('td.hid') || '/draft/note.pdf',
  current_setting('td.payload')::jsonb
) as saved \gset
select set_config('td.saved', :'saved', false);

do $$ begin
  assert (select count(*) from public.trade_document) = 1, 'one document row is written';
  assert (select count(*) from public.trade where document_id = '83000000-0000-0000-0000-000000000001') = 2,
    'both trades point at the document';
  assert (select source from public.trade where ticker = 'VAS') = 'manual', 'an extracted trade stays manual';
  assert (select external_id from public.trade where ticker = 'VAS') is null, 'an extracted trade has no external id';
  assert (select fee_cents from public.trade where ticker = 'VGS') = 0, 'an omitted fee is nil';
  assert (select price_per_unit_microdollars from public.trade where ticker = 'VGS') = 33_083_072,
    'a partial-cent price is saved exactly';
  assert (select units from public.trade where ticker = 'VAS') = 10.5, 'fractional units round-trip';
end $$;

do $$ begin
  assert current_setting('td.saved')::integer = 2, 'the function reports the trades it inserted';
end $$;

-- A retried save replays the same ids and writes nothing more.
select public.create_trades_with_document(
  current_setting('td.hid')::uuid,
  '83000000-0000-0000-0000-000000000001',
  current_setting('td.hid') || '/draft/note.pdf',
  current_setting('td.payload')::jsonb
) as retried \gset
select set_config('td.retried', :'retried', false);

do $$ begin
  assert current_setting('td.retried')::integer = 0, 'a retried save inserts nothing';
  assert (select count(*) from public.trade) = 2, 'a retried save adds no trades';
  assert (select count(*) from public.trade_document) = 1, 'a retried save adds no documents';
end $$;

-- A document is household-scoped: another household sees none.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","email":"tdoc-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as bhid \gset

do $$ begin
  assert (select count(*) from public.trade_document) = 0, 'another household sees no documents';
end $$;

do $$
begin
  begin
    perform public.create_trades_with_document(
      current_setting('td.hid')::uuid,
      '83000000-0000-0000-0000-000000000002',
      current_setting('td.hid') || '/draft/other.pdf',
      current_setting('td.payload')::jsonb
    );
    raise exception 'FAIL: a document was saved into another household';
  exception when insufficient_privilege then
    raise notice 'PASS: a document cannot be saved into another household';
  end;
end $$;

-- A document's path is unique.
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","email":"tdoc-ada@example.com"}', true);

do $$
begin
  begin
    insert into public.trade_document (household_id, storage_path)
      values (current_setting('td.hid')::uuid, current_setting('td.hid') || '/draft/note.pdf');
    raise exception 'FAIL: a duplicate storage path was saved';
  exception when unique_violation then
    raise notice 'PASS: a document path is unique';
  end;
end $$;

-- Deleting the document leaves its trades, with no document.
delete from public.trade_document;

do $$ begin
  assert (select count(*) from public.trade) = 2, 'deleting a document keeps its trades';
  assert (select count(*) from public.trade where document_id is null) = 2, 'the trades lose only the document link';
  assert (select count(*) from public.trade where household_id = current_setting('td.hid')::uuid) = 2,
    'the trades keep their household';
end $$;

rollback;
