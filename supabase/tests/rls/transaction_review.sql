-- Assertions for review_transaction, the only client write path to
-- `transactions`.
--
-- Members hold no table `update` grant, so a synced row's amounts and ids are
-- out of their reach. The function sets the note (trimmed, blank clears, null
-- leaves) and the review state (true stamps the caller's member, false clears,
-- null leaves) on a transaction the caller can see: a joint-account row is
-- shared, so the last write wins; a co-member's individual account, and another
-- household, are out of reach.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '81200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'review-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'review-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '81200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'review-carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81200000-0000-0000-0000-000000000001","email":"review-alice@example.com"}', true);
select public.create_household('Review Household', 'Alice') as hid \gset
select set_config('rev.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select set_config('rev.amid', :'amid', false);
select invite_code as code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"81200000-0000-0000-0000-000000000002","email":"review-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');
select id as bmid from public.members where household_id = :'hid'::uuid and id <> :'amid'::uuid \gset
select set_config('rev.bmid', :'bmid', false);

select set_config('request.jwt.claims', '{"sub":"81200000-0000-0000-0000-000000000003","email":"review-carol@example.com"}', true);
select public.create_household('Carol Household', 'Carol');

reset role;

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', null, 'Joint', 'transaction', 'up', 'rev-acc-joint'),
  (:'hid', :'amid', 'Alice''s Spending', 'transaction', 'up', 'rev-acc-alice');

insert into public.transactions
  (household_id, account_id, member_id, posted_at, amount_cents, description, kind, source, external_id)
  select :'hid', a.id, a.owner_member_id, now(), -25_00, a.name || ' spend', 'expense', 'up', 'rev-tx-' || a.external_id
  from public.accounts a where a.external_id in ('rev-acc-joint', 'rev-acc-alice');

select id as tx_joint from public.transactions where external_id = 'rev-tx-rev-acc-joint' \gset
select set_config('rev.tx_joint', :'tx_joint', false);
select id as tx_alice from public.transactions where external_id = 'rev-tx-rev-acc-alice' \gset
select set_config('rev.tx_alice', :'tx_alice', false);

-- ── Members cannot update the table directly ──────────────────────────────────

do $$ begin
  assert not has_table_privilege('authenticated', 'public.transactions', 'update'),
    'authenticated must hold no update grant on transactions';
  assert not has_any_column_privilege('authenticated', 'public.transactions', 'update'),
    'authenticated must hold no column update grant on transactions';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81200000-0000-0000-0000-000000000001","email":"review-alice@example.com"}', true);
do $$ begin
  update public.transactions set amount_cents = 1 where id = current_setting('rev.tx_alice')::uuid;
  raise exception 'Alice must not edit a synced amount';
exception when insufficient_privilege then null;
end $$;

-- ── Alice reviews the joint transaction; Bob sees it and overwrites it ────────

do $$
declare r public.transactions;
begin
  r := public.review_transaction(current_setting('rev.tx_joint')::uuid, '  Dinner with Sam  ');
  assert r.notes = 'Dinner with Sam', 'the note is stored trimmed';
  assert r.reviewed_at is not null and r.reviewed_by_member_id = current_setting('rev.amid')::uuid,
    'reviewing stamps the caller''s member';
  assert r.amount_cents = -25_00, 'reviewing leaves the synced amount alone';
end $$;

select set_config('request.jwt.claims', '{"sub":"81200000-0000-0000-0000-000000000002","email":"review-bob@example.com"}', true);
do $$
declare r public.transactions;
begin
  select * into r from public.transactions where id = current_setting('rev.tx_joint')::uuid;
  assert r.notes = 'Dinner with Sam' and r.reviewed_by_member_id = current_setting('rev.amid')::uuid,
    'a joint transaction''s note and review are shared with the co-member';

  r := public.review_transaction(current_setting('rev.tx_joint')::uuid, 'Dinner with Sam and Jo');
  assert r.notes = 'Dinner with Sam and Jo' and r.reviewed_by_member_id = current_setting('rev.bmid')::uuid,
    'the last write wins, recording who reviewed';

  -- A null note leaves it; a null review state leaves that.
  r := public.review_transaction(current_setting('rev.tx_joint')::uuid, null, false);
  assert r.notes = 'Dinner with Sam and Jo', 'a null note leaves the note';
  assert r.reviewed_at is null and r.reviewed_by_member_id is null, 'false returns it to unreviewed';

  r := public.review_transaction(current_setting('rev.tx_joint')::uuid, 'Just a note', null);
  assert r.notes = 'Just a note' and r.reviewed_at is null, 'a null review state notes without reviewing';

  r := public.review_transaction(current_setting('rev.tx_joint')::uuid, '   ');
  assert r.notes is null and r.reviewed_by_member_id = current_setting('rev.bmid')::uuid,
    'a blank note clears it';

  -- Alice's individual account is outside Bob's balance-visible set.
  begin
    perform public.review_transaction(current_setting('rev.tx_alice')::uuid, 'Peeked');
    raise exception 'Bob must not review a transaction on Alice''s individual account';
  exception when no_data_found then null;
  end;
end $$;

-- ── Another household cannot reach either row ────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"81200000-0000-0000-0000-000000000003","email":"review-carol@example.com"}', true);
do $$ begin
  begin
    perform public.review_transaction(current_setting('rev.tx_joint')::uuid, 'Peeked');
    raise exception 'Carol must not review another household''s transaction';
  exception when no_data_found then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select notes is null from public.transactions where id = current_setting('rev.tx_alice')::uuid),
    'Alice''s individual transaction is untouched';
end $$;

-- ── anon cannot call it ──────────────────────────────────────────────────────

do $$ begin
  assert not has_function_privilege('anon', 'public.review_transaction(uuid, text, boolean)', 'execute'),
    'anon must not execute review_transaction';
end $$;

rollback;
