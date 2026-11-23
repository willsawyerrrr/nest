-- Assertions for the Up category → budget group map and budget_actual_spend.
--
-- The default map is readable by every member and writable by none. A
-- household's overrides are its own: members manage them, another household
-- neither sees nor writes them. budget_actual_spend sums spend per group over
-- local dates in the household's timezone: settled by default, refunds netting
-- off, transfers and uncategorised income left out, an uncategorised expense or
-- a category mapped to no group under a null group, an override beating the
-- default. It runs as the caller, so a co-member's private account and another
-- household never count.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '82200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'actual-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '82200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'actual-bob@example.com'),
  ('00000000-0000-0000-0000-000000000000', '82200000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'actual-carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000001","email":"actual-alice@example.com"}', true);
select public.create_household('Actual Household', 'Alice') as hid \gset
select set_config('act.hid', :'hid', false);
select id as amid from public.members where household_id = :'hid'::uuid \gset
select invite_code as code from public.create_invite_code() \gset

select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000002","email":"actual-bob@example.com"}', true);
select public.join_household(:'code', 'Bob');

select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000003","email":"actual-carol@example.com"}', true);
select public.create_household('Carol Household', 'Carol') as chid \gset
select set_config('act.chid', :'chid', false);

reset role;

insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', null, 'Joint', 'transaction', 'up', 'act-acc-joint'),
  (:'hid', :'amid', 'Alice''s Spending', 'transaction', 'up', 'act-acc-alice'),
  (:'chid', null, 'Carol Joint', 'transaction', 'up', 'act-acc-carol');
select id as joint from public.accounts where external_id = 'act-acc-joint' \gset
select id as alice from public.accounts where external_id = 'act-acc-alice' \gset
select id as carol from public.accounts where external_id = 'act-acc-carol' \gset

-- The household is on Australia/Sydney (UTC+11 in November). 14:00Z on the 9th
-- is 01:00 on the 10th locally, inside the period; 12:00Z is still the 9th.
insert into public.transactions
  (household_id, account_id, posted_at, amount_cents, description, kind, status, source, external_id, external_category)
  values
  (:'hid', :'joint', '2026-11-15T01:00:00Z', -100_00, 'Groceries', 'expense', 'settled', 'up', 'act-1', 'groceries'),
  (:'hid', :'joint', '2026-11-16T01:00:00Z', 20_00, 'Groceries refund', 'income', 'settled', 'up', 'act-2', 'groceries'),
  (:'hid', :'joint', '2026-11-17T01:00:00Z', -30_00, 'Cafe', 'expense', 'pending', 'up', 'act-3', 'restaurants-and-cafes'),
  (:'hid', :'joint', '2026-11-17T01:00:00Z', -50_00, 'Round up', 'transfer', 'settled', 'up', 'act-4', null),
  (:'hid', :'joint', '2026-11-18T01:00:00Z', 3_000_00, 'Pay', 'income', 'settled', 'up', 'act-5', null),
  (:'hid', :'joint', '2026-11-18T01:00:00Z', -15_00, 'Pay anyone', 'expense', 'settled', 'up', 'act-6', null),
  (:'hid', :'joint', '2026-11-19T01:00:00Z', -40_00, 'Bottle shop', 'expense', 'settled', 'up', 'act-7', 'booze'),
  (:'hid', :'joint', '2026-11-19T01:00:00Z', -5_00, 'Vape', 'expense', 'settled', 'up', 'act-8', 'tobacco-and-vaping'),
  (:'hid', :'joint', '2026-11-09T12:00:00Z', -999_00, 'Before the period', 'expense', 'settled', 'up', 'act-9', 'groceries'),
  (:'hid', :'joint', '2026-11-09T14:00:00Z', -100_00, 'First local day', 'expense', 'settled', 'up', 'act-10', 'groceries'),
  (:'hid', :'joint', '2026-11-23T12:59:00Z', -1_00, 'Last local minute', 'expense', 'settled', 'up', 'act-11', 'groceries'),
  (:'hid', :'joint', '2026-11-23T13:00:00Z', -888_00, 'After the period', 'expense', 'settled', 'up', 'act-12', 'groceries'),
  (:'hid', :'alice', '2026-11-15T01:00:00Z', -70_00, 'Alice groceries', 'expense', 'settled', 'up', 'act-13', 'groceries'),
  (:'chid', :'carol', '2026-11-15T01:00:00Z', -1_000_00, 'Carol groceries', 'expense', 'settled', 'up', 'act-14', 'groceries');

-- ── The default map: readable, never writable ─────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000001","email":"actual-alice@example.com"}', true);
do $$ begin
  assert (select line_group from public.up_category_default_group where category_id = 'groceries') = 'needs',
    'members read the default map';
  begin
    update public.up_category_default_group set line_group = 'wants' where category_id = 'groceries';
    raise exception 'members must not edit the default map';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── Alice overrides two categories; Carol sees and writes neither ─────────────

insert into public.up_category_group (household_id, category_id, line_group) values
  (current_setting('act.hid')::uuid, 'booze', 'wants'),
  (current_setting('act.hid')::uuid, 'tobacco-and-vaping', null);

select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000003","email":"actual-carol@example.com"}', true);
do $$ begin
  assert (select count(*) from public.up_category_group) = 0,
    'another household''s overrides are invisible';
  begin
    insert into public.up_category_group (household_id, category_id, line_group)
      values (current_setting('act.hid')::uuid, 'groceries', 'wants');
    raise exception 'Carol must not write another household''s overrides';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── Alice: the joint account and her own ──────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000001","email":"actual-alice@example.com"}', true);
do $$
declare
  needs bigint;
  wants bigint;
  disc bigint;
  none bigint;
begin
  select spent_cents into needs from public.budget_actual_spend('2026-11-10', '2026-11-23') where line_group = 'needs';
  select spent_cents into wants from public.budget_actual_spend('2026-11-10', '2026-11-23') where line_group = 'wants';
  select spent_cents into disc from public.budget_actual_spend('2026-11-10', '2026-11-23') where line_group = 'discretionary';
  select spent_cents into none from public.budget_actual_spend('2026-11-10', '2026-11-23') where line_group is null;
  assert needs = 100_00 - 20_00 + 100_00 + 1_00 + 70_00,
    format('needs nets the refund, keeps the local-day bounds, and counts Alice''s own account: %s', needs);
  assert wants = 40_00, format('an override beats the default and pending is left out: %s', wants);
  assert disc is null, 'a category overridden away leaves its default group';
  assert none = 15_00 + 5_00, format('uncategorised spend and a category mapped to none sit under no group: %s', none);

  select spent_cents into wants from public.budget_actual_spend('2026-11-10', '2026-11-23', true) where line_group = 'wants';
  assert wants = 70_00, format('pending counts when asked: %s', wants);
end $$;

-- ── Bob: the joint account only ───────────────────────────────────────────────

select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000002","email":"actual-bob@example.com"}', true);
do $$ begin
  assert (select spent_cents from public.budget_actual_spend('2026-11-10', '2026-11-23') where line_group = 'needs')
    = 100_00 - 20_00 + 100_00 + 1_00,
    'a co-member''s private account never counts';
end $$;

-- ── Carol: her own household only, on the default map ─────────────────────────

select set_config('request.jwt.claims', '{"sub":"82200000-0000-0000-0000-000000000003","email":"actual-carol@example.com"}', true);
do $$ begin
  assert (select count(*) from public.budget_actual_spend('2026-11-10', '2026-11-23')) = 1
    and (select spent_cents from public.budget_actual_spend('2026-11-10', '2026-11-23') where line_group = 'needs') = 1_000_00,
    'another household''s spend never counts';
end $$;

reset role;
rollback;
