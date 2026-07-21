-- Per-account balance privacy within a household.
--
-- Household membership alone no longer grants sight of every account's balance.
-- A member sees the full row (including balance_cents) only for accounts whose
-- balance is theirs to see — the "balance-visible" set:
--   • shared/joint accounts (owner_member_id is null),
--   • their own accounts (owner_member_id is one of their member ids), and
--   • any household superannuation account (retirement planning stays joint),
--     identified by being linked from a super_profile.
-- A co-member's individual accounts (their everyday spending, their savers) are
-- excluded from this surface, so their balance_cents and their transactions are
-- never returned — not via select, and not via an update/delete ... returning.
--
-- Budgeting and pay-split planning still need to name a co-member's spending
-- account (to route a budget line to it and to sum its recommended split), so a
-- separate identity-only surface, account_directory, exposes name/type/source
-- (never balance) for shared accounts, own accounts, and anyone's transaction
-- accounts. A co-member's savers and other individual accounts appear nowhere.

-- ── Helper functions (SECURITY DEFINER to resolve the caller past table RLS) ──

create function public.current_member_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id from public.members where user_id = (select auth.uid());
$$;

revoke execute on function public.current_member_ids() from public;
grant execute on function public.current_member_ids() to authenticated;

create function public.household_super_account_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select sp.linked_account_id
  from public.super_profile sp
  where sp.linked_account_id is not null
    and sp.household_id in (select public.household_ids_for_current_user());
$$;

revoke execute on function public.household_super_account_ids() from public;
grant execute on function public.household_super_account_ids() to authenticated;

-- The balance-visible account id set, resolved past accounts RLS so it can gate
-- the transactions policies without recursing through the accounts policies.
create function public.visible_balance_account_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select a.id
  from public.accounts a
  where a.household_id in (select public.household_ids_for_current_user())
    and (
      a.owner_member_id is null
      or a.owner_member_id in (select public.current_member_ids())
      or a.id in (select public.household_super_account_ids())
    );
$$;

revoke execute on function public.visible_balance_account_ids() from public;
grant execute on function public.visible_balance_account_ids() to authenticated;

-- ── Accounts: split the blanket policy into per-command, balance-gated policies ─

drop policy "household members manage accounts" on public.accounts;

create policy "household members read visible-balance accounts" on public.accounts
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      owner_member_id is null
      or owner_member_id in (select public.current_member_ids())
      or id in (select public.household_super_account_ids())
    )
  );

-- A member may create only shared or self-owned accounts, never one attributed
-- to a co-member.
create policy "household members insert own or shared accounts" on public.accounts
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (
      owner_member_id is null
      or owner_member_id in (select public.current_member_ids())
    )
  );

create policy "household members update visible-balance accounts" on public.accounts
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      owner_member_id is null
      or owner_member_id in (select public.current_member_ids())
      or id in (select public.household_super_account_ids())
    )
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (
      owner_member_id is null
      or owner_member_id in (select public.current_member_ids())
    )
  );

create policy "household members delete visible-balance accounts" on public.accounts
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      owner_member_id is null
      or owner_member_id in (select public.current_member_ids())
      or id in (select public.household_super_account_ids())
    )
  );

-- ── Transactions: gated to the balance-visible account set ───────────────────

drop policy "household members manage transactions" on public.transactions;

create policy "household members read visible-balance transactions" on public.transactions
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

create policy "household members insert visible-balance transactions" on public.transactions
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

create policy "household members update visible-balance transactions" on public.transactions
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

create policy "household members delete visible-balance transactions" on public.transactions
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

-- ── account_directory: identity-only surface for budgeting and splits ────────
--
-- A definer's-rights view (security_invoker = off) so it reads past accounts RLS
-- and applies its own, wider rule: it exposes no balance column, so naming a
-- co-member's spending account leaks nothing. It carries shared accounts, the
-- caller's own accounts, and anyone's transaction (spending) accounts; a
-- co-member's savers and other individual accounts are absent entirely.

create view public.account_directory
with (security_invoker = off) as
  select
    a.id,
    a.household_id,
    a.owner_member_id,
    a.name,
    a.type,
    a.source
  from public.accounts a
  where a.household_id in (select public.household_ids_for_current_user())
    and (
      a.owner_member_id is null
      or a.owner_member_id in (select public.current_member_ids())
      or a.type = 'transaction'
    );

comment on view public.account_directory is 'Identity-only account surface (no balance) for budget-line routing and pay-split totals: shared accounts, the caller''s own accounts, and any member''s transaction accounts. A co-member''s savers and other individual accounts are excluded.';

grant select on public.account_directory to authenticated;
