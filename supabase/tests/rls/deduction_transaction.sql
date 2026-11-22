-- Assertions for a deduction created from a transaction.
--
-- `deduction.transaction_id` links a deduction to the household's ledger
-- transaction it came from, through a household-scoped composite foreign key.
-- `create_deduction_with_receipt` carries the link, one transaction backs at
-- most one deduction, a transaction in another household cannot be linked,
-- deleting the transaction clears the link and keeps the deduction, and
-- deleting the deduction frees the transaction.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'dedtx-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81300000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'dedtx-bob@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81300000-0000-0000-0000-000000000001","email":"dedtx-alice@example.com"}', true);
select public.create_household('Deduction Household', 'Alice') as hid \gset
select set_config('dtx.hid', :'hid', false);
select id as mid from public.members where household_id = :'hid'::uuid \gset
select set_config('dtx.mid', :'mid', false);

select set_config('request.jwt.claims', '{"sub":"81300000-0000-0000-0000-000000000002","email":"dedtx-bob@example.com"}', true);
select public.create_household('Other Household', 'Bob') as ohid \gset
select set_config('dtx.ohid', :'ohid', false);

reset role;

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'hid', :'mid', 'Alice''s Spending', 'transaction', 'up', 'dtx-acc');
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'ohid', null, 'Other Joint', 'transaction', 'up', 'dtx-acc-other');

insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, source, external_id)
  select :'hid', a.id, now(), -120_00, 'Bunnings', 'expense', 'up', 'dtx-tx-' || n
  from public.accounts a, generate_series(1, 2) n where a.external_id = 'dtx-acc';
insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, source, external_id)
  select :'ohid', a.id, now(), -50_00, 'Elsewhere', 'expense', 'up', 'dtx-tx-other'
  from public.accounts a where a.external_id = 'dtx-acc-other';

select id as tx1 from public.transactions where external_id = 'dtx-tx-1' \gset
select id as tx2 from public.transactions where external_id = 'dtx-tx-2' \gset
select id as txo from public.transactions where external_id = 'dtx-tx-other' \gset
select set_config('dtx.tx1', :'tx1', false);
select set_config('dtx.tx2', :'tx2', false);
select set_config('dtx.txo', :'txo', false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81300000-0000-0000-0000-000000000001","email":"dedtx-alice@example.com"}', true);

-- ── The RPC carries the link ──────────────────────────────────────────────────

select public.create_deduction_with_receipt(jsonb_build_object(
  'id', 'ddd10000-0000-0000-0000-000000000001',
  'household_id', current_setting('dtx.hid'),
  'member_id', current_setting('dtx.mid'),
  'description', 'Bunnings',
  'amount_cents', 120_00,
  'deduction_date', '2026-08-01',
  'financial_year', 2027,
  'transaction_id', current_setting('dtx.tx1')
));

do $$ begin
  assert (select transaction_id from public.deduction where id = 'ddd10000-0000-0000-0000-000000000001')
    = current_setting('dtx.tx1')::uuid,
    'the RPC should store the transaction the deduction came from';
end $$;

-- A retried save of the same deduction keeps the link, even with none sent.
select public.create_deduction_with_receipt(jsonb_build_object(
  'id', 'ddd10000-0000-0000-0000-000000000001',
  'household_id', current_setting('dtx.hid'),
  'member_id', current_setting('dtx.mid'),
  'description', 'Bunnings drill',
  'amount_cents', 120_00,
  'deduction_date', '2026-08-01',
  'financial_year', 2027
));

do $$ begin
  assert (select transaction_id from public.deduction where id = 'ddd10000-0000-0000-0000-000000000001')
    = current_setting('dtx.tx1')::uuid,
    'a retried save should leave the link in place';
end $$;

-- A hand-entered deduction has no source.
select public.create_deduction_with_receipt(jsonb_build_object(
  'id', 'ddd10000-0000-0000-0000-000000000002',
  'household_id', current_setting('dtx.hid'),
  'member_id', current_setting('dtx.mid'),
  'description', 'Pens',
  'amount_cents', 5_00,
  'deduction_date', '2026-08-02',
  'financial_year', 2027
));

do $$ begin
  assert (select transaction_id from public.deduction where id = 'ddd10000-0000-0000-0000-000000000002') is null,
    'a hand-entered deduction should have no transaction';
end $$;

-- ── One deduction per transaction ─────────────────────────────────────────────

do $$
begin
  perform public.create_deduction_with_receipt(jsonb_build_object(
    'id', 'ddd10000-0000-0000-0000-000000000003',
    'household_id', current_setting('dtx.hid'),
    'member_id', current_setting('dtx.mid'),
    'description', 'Bunnings again',
    'amount_cents', 120_00,
    'deduction_date', '2026-08-01',
    'financial_year', 2027,
    'transaction_id', current_setting('dtx.tx1')
  ));
  raise exception 'FAIL: a transaction backed a second deduction';
exception
  when unique_violation then
    raise notice 'PASS: a transaction backs at most one deduction';
end $$;

-- ── The transaction must be in the same household ─────────────────────────────

do $$
begin
  insert into public.deduction (household_id, member_id, description, amount_cents, deduction_date, financial_year, transaction_id)
    values (current_setting('dtx.hid')::uuid, current_setting('dtx.mid')::uuid, 'Foreign', 50_00, '2026-08-01', 2027, current_setting('dtx.txo')::uuid);
  raise exception 'FAIL: a deduction linked a transaction in another household';
exception
  when foreign_key_violation then
    raise notice 'PASS: a deduction cannot link another household''s transaction';
end $$;

-- ── Deleting the deduction frees the transaction ──────────────────────────────

delete from public.deduction where id = 'ddd10000-0000-0000-0000-000000000001';

insert into public.deduction (id, household_id, member_id, description, amount_cents, deduction_date, financial_year, transaction_id)
  values ('ddd10000-0000-0000-0000-000000000004', current_setting('dtx.hid')::uuid, current_setting('dtx.mid')::uuid,
    'Bunnings, again', 120_00, '2026-08-01', 2027, current_setting('dtx.tx1')::uuid);

do $$ begin
  assert (select transaction_id from public.deduction where id = 'ddd10000-0000-0000-0000-000000000004')
    = current_setting('dtx.tx1')::uuid,
    'a freed transaction should back a new deduction';
end $$;

-- ── Deleting the transaction clears the link and keeps the deduction ──────────

reset role;
delete from public.transactions where id = current_setting('dtx.tx1')::uuid;

do $$ begin
  assert (select count(*) from public.deduction where id = 'ddd10000-0000-0000-0000-000000000004') = 1,
    'deleting the transaction should leave the deduction in place';
  assert (select transaction_id from public.deduction where id = 'ddd10000-0000-0000-0000-000000000004') is null,
    'deleting the transaction should clear the link';
  assert (select amount_cents from public.deduction where id = 'ddd10000-0000-0000-0000-000000000004') = 120_00,
    'deleting the transaction should leave the deduction''s figures untouched';
end $$;

rollback;
