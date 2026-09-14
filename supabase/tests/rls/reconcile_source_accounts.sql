-- Assertions for reconcile_source_accounts, the sync pass that removes or flags
-- a member's individually-owned accounts from one source once that source
-- stops reporting them. up-sync and redbark-sync each call it, passing their
-- own source, so an account's source scopes the reconcile to it alone.
--
-- The RPC is SECURITY DEFINER, granted to service_role alone (service_role holds
-- no delete on `accounts`). Given a member, a source, and the external ids that
-- source returned this run it: clears `deleted_from_source_at` on the accounts
-- present; deletes the absent ones nothing references (account_balance
-- cascades); flags `deleted_from_source_at` on the absent ones a goal, budget
-- line, pay account, or super link still holds. Joint accounts (owned by
-- neither member), other households' rows, and accounts from a different
-- source are out of scope.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'reconcile-alice@example.com'),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'reconcile-bob@example.com');

-- ── Alice's household: four Up accounts, a Redbark account, and a manual one ─

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000001","email":"reconcile-alice@example.com"}', true);
select public.create_household('Alice Household', 'Alice') as hid \gset
select set_config('test.hid', :'hid', false);
select id as mid from public.members where household_id = :'hid' \gset
select set_config('test.mid', :'mid', false);

-- An unreferenced saver, a referenced saver, a saver already flagged from a
-- prior run, and a joint account — all source = 'up' — plus a Redbark account
-- for the same member, to prove p_source scopes the reconcile to one source.
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id) values
  (:'hid', :'mid', 'Unused saver', 'savings', 'up', 'up-s-unused'),
  (:'hid', :'mid', 'Linked saver', 'savings', 'up', 'up-s-linked'),
  (:'hid', :'mid', 'Reappearing saver', 'savings', 'up', 'up-s-reappear'),
  (:'hid', null, 'Joint spending', 'transaction', 'up', 'up-joint'),
  (:'hid', :'mid', 'Manual savings', 'savings', 'manual', null),
  (:'hid', :'mid', 'Redbark everyday', 'transaction', 'redbark', 'rbk-a-everyday');

update public.accounts set deleted_from_source_at = now() - interval '1 day'
  where external_id = 'up-s-reappear';

select id as aid_unused from public.accounts where external_id = 'up-s-unused' \gset
select set_config('test.aid_unused', :'aid_unused', false);
select id as aid_linked from public.accounts where external_id = 'up-s-linked' \gset

insert into public.account_balance (account_id, household_id, balance_cents)
  values (:'aid_unused', :'hid', 100_00);

-- A goal holds the linked saver.
insert into public.savings_goal (household_id, name, target_amount_cents, target_date)
  values (:'hid', 'House deposit', 1_000_000_00, null);
update public.savings_goal set linked_account_id = :'aid_linked' where household_id = :'hid';

-- ── Bob's household: one Up account, to prove the reconcile is scoped ────────

select set_config('request.jwt.claims', '{"sub":"60000000-0000-0000-0000-000000000002","email":"reconcile-bob@example.com"}', true);
select public.create_household('Bob Household', 'Bob') as hid2 \gset
select id as mid2 from public.members where household_id = :'hid2' \gset
insert into public.accounts (household_id, owner_member_id, name, type, source, external_id)
  values (:'hid2', :'mid2', 'Bob saver', 'savings', 'up', 'up-b-saver');

-- ── Reconcile Alice's member's Up accounts against a set holding only the
--    reappearing saver — the Redbark account is a different source entirely ──

reset role;
set local role service_role;
select public.reconcile_source_accounts(
  current_setting('test.hid')::uuid,
  current_setting('test.mid')::uuid,
  'up',
  array['up-s-reappear']::text[]
);

do $$
declare v_aid_unused uuid := current_setting('test.aid_unused')::uuid;
begin
  assert not exists (select 1 from public.accounts where external_id = 'up-s-unused'),
    'an unreferenced Up account the token dropped should be deleted';
  assert not exists (select 1 from public.account_balance where account_id = v_aid_unused),
    'the deleted account''s balance should cascade away';

  assert exists (select 1 from public.accounts where external_id = 'up-s-linked'),
    'a referenced Up account the token dropped should be kept';
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-s-linked') is not null,
    'a referenced Up account the token dropped should be flagged deleted_from_source_at';

  assert (select deleted_from_source_at from public.accounts where external_id = 'up-s-reappear') is null,
    'an Up account the token reported again should have its flag cleared';

  assert exists (select 1 from public.accounts where external_id = 'up-joint'),
    'a joint account (owned by neither member) is out of scope and untouched';
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-joint') is null,
    'a joint account is never flagged by a per-member reconcile';

  assert exists (select 1 from public.accounts where external_id is null and source = 'manual'),
    'a manual account is never reconciled';

  assert exists (select 1 from public.accounts where external_id = 'up-b-saver'),
    'another household''s Up account is out of scope';

  assert exists (select 1 from public.accounts where external_id = 'rbk-a-everyday'),
    'a Redbark account for the same member is a different source and out of scope';
  assert (select deleted_from_source_at from public.accounts where external_id = 'rbk-a-everyday') is null,
    'an Up-sourced reconcile never flags a Redbark account, even for the same member';
end $$;

-- ── A later run reports the linked saver again: the flag clears ─────────────

select public.reconcile_source_accounts(
  current_setting('test.hid')::uuid,
  current_setting('test.mid')::uuid,
  'up',
  array['up-s-linked', 'up-s-reappear']::text[]
);

do $$ begin
  assert (select deleted_from_source_at from public.accounts where external_id = 'up-s-linked') is null,
    'a flagged account that reappears has its flag cleared';
end $$;

-- ── Grants: service_role executes it, authenticated cannot ──────────────────

reset role;
do $$ begin
  assert has_function_privilege('service_role', 'public.reconcile_source_accounts(uuid, uuid, public.ledger_source, text[])', 'execute'),
    'service_role should execute reconcile_source_accounts';
  assert not has_function_privilege('authenticated', 'public.reconcile_source_accounts(uuid, uuid, public.ledger_source, text[])', 'execute'),
    'authenticated must not execute reconcile_source_accounts';
end $$;

rollback;
