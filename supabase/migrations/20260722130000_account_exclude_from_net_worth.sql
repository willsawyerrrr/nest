-- Let the household exclude an account from net-worth tracking.
--
-- A shared, household-wide flag: both partners' net-worth views drop the
-- account, and it is not per-person. The existing accounts policies already
-- cover the column, so no RLS change is needed, and it stays off the
-- account_directory view, which carries no balance and never feeds net worth.

alter table public.accounts
  add column exclude_from_net_worth boolean not null default false;

comment on column public.accounts.exclude_from_net_worth is 'When true, the account is left out of net-worth totals only; it still counts towards retirement projection and budgeting.';
