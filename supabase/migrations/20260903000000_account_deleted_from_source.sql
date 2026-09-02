-- Reconcile Nest's Up-sourced accounts against what a member's token still reports.
--
-- up-sync only ever upserts the accounts Up returns, so a saver closed in Up
-- lingers in Nest forever — in goal saver pickers, the Splits tab, and net worth.
-- Each sync now treats the account ids a member's token returned as the
-- authoritative set for that member's individually-owned `source = 'up'` accounts
-- and reconciles the rest:
--   • an account the token no longer reports and nothing references is deleted
--     (its account_balance cascades);
--   • one still referenced by a savings goal, a budget line's funding account,
--     the household pay account, or a member's super link is kept and stamped
--     `deleted_from_source_at`, which the PWA shows as "deleted in Up" with a
--     Remove-from-Nest action once the dependency is cleared;
--   • an account that reappears in a later sync has the stamp cleared.
-- The reconcile runs per member against that member's own token only, so a
-- failed or absent token read reconciles nothing, and joint accounts (owned by
-- neither member) are left untouched.

alter table public.accounts
  add column deleted_from_source_at timestamptz;

comment on column public.accounts.deleted_from_source_at is 'When set, the source (Up) stopped reporting this account but something in Nest still references it; the sync stamps it and clears it if the account reappears. Null for a live account.';

-- ── Views: carry the new column through both account surfaces ─────────────────
--
-- Both are plain security_invoker views expanded from `accounts` at creation, so
-- a new base column reaches them only on recreate.

drop view public.account_directory;

create view public.account_directory
with (security_invoker = on) as
  select
    a.id,
    a.household_id,
    a.owner_member_id,
    a.name,
    a.type,
    a.source,
    a.deleted_from_source_at
  from public.accounts a
  where a.owner_member_id is null
    or a.owner_member_id in (select public.current_member_ids())
    or a.type = 'transaction';

comment on view public.account_directory is 'Identity-only account surface (no balance) for budget-line routing and pay-split totals: shared accounts, the caller''s own accounts, and any member''s transaction accounts. A co-member''s savers and super accounts are excluded. A plain security_invoker view over the accounts identity table.';

grant select on public.account_directory to authenticated;

drop view public.accounts_with_balance;

create view public.accounts_with_balance
with (security_invoker = on) as
  select a.*, b.balance_cents
  from public.accounts a
  join public.account_balance b
    on b.account_id = a.id and b.household_id = a.household_id;

comment on view public.accounts_with_balance is 'Account identity joined to its balance for the balance-visible set (shared, own, and household super accounts). A plain security_invoker view: the accounts and account_balance policies together confine it, so a co-member''s spending or saver balance never appears.';

grant select on public.accounts_with_balance to authenticated;

-- ── up-sync reconcile: delete or flag the accounts a token stopped reporting ──
--
-- Called once per member per sync, after the account upsert, with every Up
-- account id that member's token returned this run. It only ever touches that
-- member's individually-owned `source = 'up'` accounts, so a member whose token
-- was unreadable is never passed here and joint accounts stay out of scope.
-- p_present_external_ids empty is a valid "this member has no Up accounts"
-- result and reconciles them all, mirroring sync_up_gift_transactions.

create function public.reconcile_up_accounts(
  p_household_id uuid,
  p_owner_member_id uuid,
  p_present_external_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Reported again: it is not deleted-in-Up, so clear any stamp a prior run left.
  update public.accounts a
    set deleted_from_source_at = null
  where a.household_id = p_household_id
    and a.owner_member_id = p_owner_member_id
    and a.source = 'up'
    and a.deleted_from_source_at is not null
    and a.external_id = any(p_present_external_ids);

  -- Absent now but still referenced: keep it and stamp it for the PWA to prompt on.
  update public.accounts a
    set deleted_from_source_at = now()
  where a.household_id = p_household_id
    and a.owner_member_id = p_owner_member_id
    and a.source = 'up'
    and a.deleted_from_source_at is null
    and a.external_id <> all(p_present_external_ids)
    and (
      exists (select 1 from public.savings_goal g where g.linked_account_id = a.id)
      or exists (select 1 from public.budget_line b where b.destination_account_id = a.id)
      or exists (select 1 from public.households h where h.pay_account_id = a.id)
      or exists (select 1 from public.super_profile s where s.linked_account_id = a.id)
    );

  -- Absent now and unreferenced: delete it; account_balance cascades.
  delete from public.accounts a
  where a.household_id = p_household_id
    and a.owner_member_id = p_owner_member_id
    and a.source = 'up'
    and a.external_id <> all(p_present_external_ids)
    and not exists (select 1 from public.savings_goal g where g.linked_account_id = a.id)
    and not exists (select 1 from public.budget_line b where b.destination_account_id = a.id)
    and not exists (select 1 from public.households h where h.pay_account_id = a.id)
    and not exists (select 1 from public.super_profile s where s.linked_account_id = a.id);
end;
$$;

-- Like upsert_up_accounts and sync_up_gift_transactions, the function is the only
-- path service_role has to delete from `accounts` — it runs as its owner, and
-- service_role's own grants stay select/insert/update (see docs/operations.md).
revoke execute on function public.reconcile_up_accounts(uuid, uuid, text[]) from public;
grant execute on function public.reconcile_up_accounts(uuid, uuid, text[]) to service_role;
