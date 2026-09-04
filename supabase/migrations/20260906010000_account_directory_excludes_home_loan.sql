-- Keep home-loan accounts out of the routing surface. `account_directory` feeds
-- the budget-line "Funded from" picker, the pay-account picker, and the Splits
-- tab; a home loan is a liability the household pays down, never a place a pay
-- split routes money to. A joint home loan has `owner_member_id` null, so the
-- view's ownership predicate would otherwise let it through — exclude it by type.
-- `accounts_with_balance` is unchanged: net worth still reads the home-loan
-- balance from there.

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
  where a.type <> 'home_loan'
    and (
      a.owner_member_id is null
      or a.owner_member_id in (select public.current_member_ids())
      or a.type = 'transaction'
    );

comment on view public.account_directory is 'Identity-only account surface (no balance) for budget-line routing and pay-split totals: shared accounts, the caller''s own accounts, and any member''s transaction accounts. A co-member''s savers and super accounts are excluded, as are home-loan accounts (a liability, never a routing destination). A plain security_invoker view over the accounts identity table.';

grant select on public.account_directory to authenticated;
