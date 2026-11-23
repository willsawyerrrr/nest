-- Assertions for sync_up_transactions and delete_up_transactions, up-sync's
-- write path to `transactions`.
--
-- Both are SECURITY DEFINER and granted to service_role alone. The upsert lands
-- rows on (source, external_id), reports which it inserted, never writes
-- `notes`, inserts Salary and Interest rows already reviewed (and never touches
-- review state on an update), stamps `external_category_since` only when the category changes,
-- holds a linked gift purchase to its transaction's amount, and leaves a
-- conflicting row in another household alone. The delete removes the named Up
-- rows in the household except those a gift purchase links.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'sync-tx-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'sync-tx-bob@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000001","email":"sync-tx-alice@example.com"}', true);
select public.create_household('Sync Alice Household', 'Alice') as hid \gset
select set_config('test.hid', :'hid', false);
select id as mid from public.members where household_id = :'hid' \gset
select set_config('test.mid', :'mid', false);
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'hid', :'mid', 'Alice''s Spending', 'transaction', 'up', 'up-acc-alice');
select id as aid from public.accounts where external_id = 'up-acc-alice' \gset
select set_config('test.aid', :'aid', false);

select set_config('request.jwt.claims', '{"sub":"62000000-0000-0000-0000-000000000002","email":"sync-tx-bob@example.com"}', true);
select public.create_household('Sync Bob Household', 'Bob') as hid2 \gset
select set_config('test.hid2', :'hid2', false);
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'hid2', null, 'Bob joint', 'transaction', 'up', 'up-acc-bob');
select id as aid2 from public.accounts where external_id = 'up-acc-bob' \gset

reset role;

-- Bob's household already holds an Up row whose id Alice's sync will name.
insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, source, external_id)
  values (:'hid2', :'aid2', now(), -1_00, 'Bob''s row', 'expense', 'up', 'tx-bob');

-- ── authenticated cannot call either function ──────────────────────────────────

set local role authenticated;
do $$
begin
  begin
    perform public.sync_up_transactions(current_setting('test.hid')::uuid, '[]'::jsonb);
    raise exception 'authenticated should not execute sync_up_transactions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_up_transactions(current_setting('test.hid')::uuid, array['tx-1']);
    raise exception 'authenticated should not execute delete_up_transactions';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── First sync inserts, with every Up-side column ─────────────────────────────

set local role service_role;
create temp table first_sync as
select * from public.sync_up_transactions(
  current_setting('test.hid')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-1', 'external_category', 'gifts-and-charity',
      'external_parent_category', 'personal', 'is_categorizable', true,
      'transaction_type', 'Purchase', 'deep_link_url', 'up://transaction/tx-1',
      'up_message', null, 'up_note', 'For Mum', 'performing_customer_name', 'Alice',
      'posted_at', '2026-11-01T09:00:00+11:00', 'amount_cents', -40_00,
      'description', 'Florist', 'kind', 'expense', 'status', 'pending'),
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-transfer', 'external_category', null,
      'external_parent_category', null, 'is_categorizable', false,
      'transaction_type', 'Transfer', 'deep_link_url', 'up://transaction/tx-transfer',
      'up_message', 'Rent', 'up_note', null, 'performing_customer_name', 'Alice',
      'posted_at', '2026-11-02T09:00:00+11:00', 'amount_cents', -500_00,
      'description', 'Transfer to Saver', 'kind', 'transfer', 'status', 'settled'),
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-bob', 'external_category', null,
      'external_parent_category', null, 'is_categorizable', true,
      'transaction_type', null, 'deep_link_url', 'up://transaction/tx-bob',
      'up_message', null, 'up_note', null, 'performing_customer_name', null,
      'posted_at', '2026-11-02T09:00:00+11:00', 'amount_cents', -2_00,
      'description', 'Hijack', 'kind', 'expense', 'status', 'settled')
  )
);
reset role;

do $$
declare
  r record;
begin
  assert (select count(*) from first_sync) = 2,
    'the two Alice rows land; the row conflicting with Bob''s household does not';
  assert (select bool_and(inserted) from first_sync), 'a first sync reports its rows inserted';

  select * into r from public.transactions where external_id = 'tx-1';
  assert r.household_id = current_setting('test.hid')::uuid, 'the row is in the named household';
  assert r.external_parent_category = 'personal' and r.is_categorizable
    and r.transaction_type = 'Purchase' and r.deep_link_url = 'up://transaction/tx-1'
    and r.up_note = 'For Mum' and r.up_message is null
    and r.performing_customer_name = 'Alice',
    'every Up-side column lands';
  assert r.notes is null, 'the sync writes no notes';

  assert (select kind from public.transactions where external_id = 'tx-transfer') = 'transfer',
    'a transfer lands as the transfer kind';

  select * into r from public.transactions where external_id = 'tx-bob';
  assert r.household_id = current_setting('test.hid2')::uuid and r.description = 'Bob''s row',
    'a conflicting row in another household is left alone';
end;
$$;

-- The household annotates the row and claims it as a gift.
update public.transactions set notes = 'Mum''s birthday', external_category_since = '2026-11-01'
  where external_id = 'tx-1';
insert into public.gift_discretionary_budget (household_id, budgeted_amount_cents)
  values (:'hid', 100_00);
insert into public.gift_purchase
  (household_id, gift_discretionary_budget_id, amount_cents, description, purchased_on, transaction_id)
  select :'hid', gdb.id, 40_00, 'Flowers', '2026-11-01', t.id
  from public.gift_discretionary_budget gdb, public.transactions t
  where gdb.household_id = :'hid' and t.external_id = 'tx-1';

-- ── A re-sync updates in place, keeps notes, and reprices the purchase ────────

set local role service_role;
create temp table second_sync as
select * from public.sync_up_transactions(
  current_setting('test.hid')::uuid,
  jsonb_build_array(jsonb_build_object(
    'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
    'external_id', 'tx-1', 'external_category', 'gifts-and-charity',
    'external_parent_category', 'personal', 'is_categorizable', true,
    'transaction_type', 'Purchase', 'deep_link_url', 'up://transaction/tx-1',
    'up_message', null, 'up_note', 'For Mum (edited)', 'performing_customer_name', 'Alice',
    'posted_at', '2026-11-02T09:00:00+11:00', 'amount_cents', -42_50,
    'description', 'Florist', 'kind', 'expense', 'status', 'settled'))
);
reset role;

do $$
declare
  r record;
begin
  assert (select count(*) from second_sync) = 1 and not (select inserted from second_sync),
    'a re-sync reports its row as an update';
  select * into r from public.transactions where external_id = 'tx-1';
  assert r.status = 'settled' and r.amount_cents = -42_50 and r.up_note = 'For Mum (edited)',
    'the row refreshes from Up';
  assert r.notes = 'Mum''s birthday', 'the household''s notes survive a sync';
  assert r.external_category_since = '2026-11-01'::timestamptz,
    'an unchanged category keeps its since stamp';
  assert (select amount_cents from public.gift_purchase where transaction_id = r.id) = 42_50,
    'a linked purchase follows its transaction''s settled amount';
end;
$$;

-- ── Recategorising restamps external_category_since ──────────────────────────

set local role service_role;
select * from public.sync_up_transactions(
  current_setting('test.hid')::uuid,
  jsonb_build_array(jsonb_build_object(
    'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
    'external_id', 'tx-1', 'external_category', 'clothing-and-accessories',
    'external_parent_category', 'personal', 'is_categorizable', true,
    'transaction_type', 'Purchase', 'deep_link_url', 'up://transaction/tx-1',
    'up_message', null, 'up_note', null, 'performing_customer_name', 'Alice',
    'posted_at', '2026-11-02T09:00:00+11:00', 'amount_cents', -42_50,
    'description', 'Florist', 'kind', 'expense', 'status', 'settled'))
);
reset role;

do $$
begin
  assert (select external_category_since > '2026-11-01'::timestamptz
    and external_category = 'clothing-and-accessories'
    from public.transactions where external_id = 'tx-1'),
    'a changed category restamps external_category_since';
end;
$$;

-- ── Salary and Interest insert already reviewed ──────────────────────────────

set local role service_role;
select * from public.sync_up_transactions(
  current_setting('test.hid')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-salary', 'external_category', null, 'external_parent_category', null,
      'is_categorizable', true, 'transaction_type', 'Salary',
      'deep_link_url', 'up://transaction/tx-salary', 'up_message', null, 'up_note', null,
      'performing_customer_name', null, 'posted_at', '2026-11-03T09:00:00+11:00',
      'amount_cents', 200000, 'description', 'Employer Pty Ltd', 'kind', 'income', 'status', 'settled'),
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-interest', 'external_category', null, 'external_parent_category', null,
      'is_categorizable', true, 'transaction_type', 'Interest',
      'deep_link_url', 'up://transaction/tx-interest', 'up_message', null, 'up_note', null,
      'performing_customer_name', null, 'posted_at', '2026-11-03T09:00:00+11:00',
      'amount_cents', 12, 'description', 'Interest', 'kind', 'income', 'status', 'settled'),
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-credit', 'external_category', null, 'external_parent_category', null,
      'is_categorizable', true, 'transaction_type', 'Direct Credit',
      'deep_link_url', 'up://transaction/tx-credit', 'up_message', null, 'up_note', null,
      'performing_customer_name', null, 'posted_at', '2026-11-03T09:00:00+11:00',
      'amount_cents', 5000, 'description', 'Refund', 'kind', 'income', 'status', 'settled'),
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-ext-transfer', 'external_category', null, 'external_parent_category', null,
      'is_categorizable', false, 'transaction_type', 'Transfer',
      'deep_link_url', 'up://transaction/tx-ext-transfer', 'up_message', null, 'up_note', null,
      'performing_customer_name', null, 'posted_at', '2026-11-03T09:00:00+11:00',
      'amount_cents', 2500, 'description', 'Transfer from $friend', 'kind', 'income', 'status', 'settled')
  )
);
reset role;

do $$
begin
  assert (select reviewed_at is not null and reviewed_by_member_id is null
    from public.transactions where external_id = 'tx-salary'),
    'a Salary row inserts reviewed, by no member';
  assert (select reviewed_at is not null and reviewed_by_member_id is null
    from public.transactions where external_id = 'tx-interest'),
    'an Interest row inserts reviewed, by no member';
  assert (select reviewed_at is null from public.transactions where external_id = 'tx-credit'),
    'a Direct Credit row still awaits review';
  assert (select reviewed_at is null from public.transactions where external_id = 'tx-ext-transfer'),
    'an incoming transfer row still awaits review';
end;
$$;

-- A member returns the salary to unreviewed; a re-sync leaves that, and leaves
-- a reviewed row reviewed.
update public.transactions set reviewed_at = null where external_id = 'tx-salary';
update public.transactions set reviewed_at = '2026-11-03', reviewed_by_member_id = :'mid'
  where external_id = 'tx-credit';

set local role service_role;
select * from public.sync_up_transactions(
  current_setting('test.hid')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-salary', 'external_category', null, 'external_parent_category', null,
      'is_categorizable', true, 'transaction_type', 'Salary',
      'deep_link_url', 'up://transaction/tx-salary', 'up_message', null, 'up_note', null,
      'performing_customer_name', null, 'posted_at', '2026-11-03T09:00:00+11:00',
      'amount_cents', 200000, 'description', 'Employer Pty Ltd', 'kind', 'income', 'status', 'settled'),
    jsonb_build_object(
      'account_id', current_setting('test.aid'), 'member_id', current_setting('test.mid'),
      'external_id', 'tx-credit', 'external_category', null, 'external_parent_category', null,
      'is_categorizable', true, 'transaction_type', 'Direct Credit',
      'deep_link_url', 'up://transaction/tx-credit', 'up_message', null, 'up_note', null,
      'performing_customer_name', null, 'posted_at', '2026-11-03T09:00:00+11:00',
      'amount_cents', 5000, 'description', 'Refund', 'kind', 'income', 'status', 'settled')
  )
);
reset role;

do $$
begin
  assert (select reviewed_at is null from public.transactions where external_id = 'tx-salary'),
    'a re-sync does not review a Salary row a member returned to unreviewed';
  assert (select reviewed_at = '2026-11-03'::timestamptz and reviewed_by_member_id is not null
    from public.transactions where external_id = 'tx-credit'),
    'a re-sync keeps a reviewed row reviewed';
end;
$$;

-- ── delete_up_transactions keeps linked rows and other households' rows ──────

set local role service_role;
select public.delete_up_transactions(
  current_setting('test.hid')::uuid,
  array['tx-1', 'tx-transfer', 'tx-bob']
);
reset role;

do $$
begin
  assert exists (select 1 from public.transactions where external_id = 'tx-1'),
    'a row a gift purchase links is kept';
  assert not exists (select 1 from public.transactions where external_id = 'tx-transfer'),
    'an unlinked row Up no longer has is deleted';
  assert exists (select 1 from public.transactions where external_id = 'tx-bob'),
    'another household''s row is out of reach';
end;
$$;

rollback;
