-- Assertions for reconcile_joint_up_accounts, the up-sync pass that removes or
-- flags a household's JOINT Up accounts once no member's token reports them.
--
-- The RPC is SECURITY DEFINER, granted to service_role alone (service_role holds
-- no delete on `accounts`). Given a household and the UNION of the external ids
-- its members' tokens returned this run it: clears `deleted_from_source_at` on
-- the joint accounts present; deletes the absent ones nothing references
-- (account_balance cascades); flags `deleted_from_source_at` on the absent ones
-- a savings goal, budget line, pay account, or super link still holds.
-- Individually-owned accounts and other households' rows are out of scope.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'reconcile-joint-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'reconcile-joint-bob@example.com');

-- ── Alice's household: four joint Up accounts, plus an individual and a manual one ─

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","email":"reconcile-joint-alice@example.com"}', true);
select public.create_household('Joint Alice Household', 'Alice') as hid \gset
select set_config('test.hid', :'hid', false);
select id as mid from public.members where household_id = :'hid' \gset
select set_config('test.mid', :'mid', false);

-- An unreferenced joint account, a referenced joint account, a joint account
-- already flagged from a prior run, an individually-owned account, and a manual
-- one.
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', null, 'Joint unused', 'savings', 'up', 'up-j-unused'),
  (:'hid', null, 'Joint linked', 'savings', 'up', 'up-j-linked'),
  (:'hid', null, 'Joint reappearing', 'savings', 'up', 'up-j-reappear'),
  (:'hid', :'mid', 'Alice individual saver', 'savings', 'up', 'up-i-alice'),
  (:'hid', null, 'Manual joint', 'savings', 'manual', null);

update public.accounts set deleted_from_source_at = now() - interval '1 day'
  where external_id = 'up-j-reappear';

select id as aid_unused from public.accounts where external_id = 'up-j-unused' \gset
select set_config('test.aid_unused', :'aid_unused', false);
select id as aid_linked from public.accounts where external_id = 'up-j-linked' \gset

insert into public.account_balance (account_id, household_id, balance_cents)
  values (:'aid_unused', :'hid', 100_00);

-- A goal holds the linked joint account.
insert into public.savings_goal (household_id, name, target_amount_cents, target_date)
  values (:'hid', 'House deposit', 1_000_000_00, null);
update public.savings_goal set linked_account_id = :'aid_linked' where household_id = :'hid';

-- ── Bob's household: one joint Up account, to prove the reconcile is scoped ──

select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000002","email":"reconcile-joint-bob@example.com"}', true);
select public.create_household('Joint Bob Household', 'Bob') as hid2 \gset
select id as mid2 from public.members where household_id = :'hid2' \gset
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'hid2', null, 'Bob joint', 'savings', 'up', 'up-b-joint');

-- ── Reconcile Alice's household against a union holding only the reappearing account ─

reset role;
set local role service_role;
select public.reconcile_joint_up_accounts(
  current_setting('test.hid')::uuid,
  array['up-j-reappear']::text[]
);

do $$
declare v_aid_unused uuid := current_setting('test.aid_unused')::uuid;
begin
  assert not exists (select 1 from public.accounts where external_id = 'up-j-unused'),
    'an unreferenced joint Up account no token reports should be deleted';
  assert not exists (select 1 from public.account_balance where account_id = v_aid_unused),
    'the deleted account''s balance should cascade away';

  assert exists (select 1 from public.accounts where external_id = 'up-j-linked'),
    'a referenced joint Up account no token reports should be kept';
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-j-linked') is not null,
    'a referenced joint Up account no token reports should be flagged deleted_from_source_at';

  assert (select deleted_from_source_at from public.accounts where external_id = 'up-j-reappear') is null,
    'a joint Up account reported again should have its flag cleared';

  assert exists (select 1 from public.accounts where external_id = 'up-i-alice'),
    'an individually-owned account is out of scope and untouched';
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-i-alice') is null,
    'an individually-owned account is never flagged by the joint reconcile';

  assert exists (select 1 from public.accounts where external_id is null and source = 'manual'),
    'a manual account is never reconciled';

  assert exists (select 1 from public.accounts where external_id = 'up-b-joint'),
    'another household''s joint Up account is out of scope';
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-b-joint') is null,
    'another household''s joint Up account is never flagged';
end $$;

-- ── A later run reports the linked account again: the flag clears ───────────

select public.reconcile_joint_up_accounts(
  current_setting('test.hid')::uuid,
  array['up-j-linked', 'up-j-reappear']::text[]
);

do $$ begin
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-j-linked') is null,
    'a flagged joint account that reappears has its flag cleared';
end $$;

-- ── Grants: service_role executes it, authenticated cannot ─────────────────

reset role;
do $$ begin
  assert has_function_privilege('service_role', 'public.reconcile_joint_up_accounts(uuid, text[])', 'execute'),
    'service_role should execute reconcile_joint_up_accounts';
  assert not has_function_privilege('authenticated', 'public.reconcile_joint_up_accounts(uuid, text[])', 'execute'),
    'authenticated must not execute reconcile_joint_up_accounts';
end $$;

rollback;
