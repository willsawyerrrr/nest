-- HELP/HECS debt: each member's single standing HELP balance.
--
-- A member carries one outstanding HELP debt at a time, independent of the
-- financial year, so this is one row per member rather than a per-FY profile.
-- The balance feeds two things: the tax engine (marginal HELP repayment) and the
-- net-worth view (a liability that reduces the household total). Money is integer
-- cents in a bigint column. RLS on household membership is the isolation
-- boundary, and a composite foreign key on (member_id, household_id) keeps the
-- reference inside the household.

create table public.help_debt (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  unique (member_id)
);
create index on public.help_debt (household_id);
comment on table public.help_debt is 'A member''s single standing HELP/HECS debt balance: an input to the tax engine and a net-worth liability.';
comment on column public.help_debt.balance_cents is 'Outstanding HELP/HECS balance in integer cents; never negative.';

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create trigger set_updated_at before update on public.help_debt
  for each row execute function public.set_updated_at();

-- ── Backfill from tax_profile, then drop the column ──────────────────────────────

-- Seed one row per member from their most recent tax-profile HELP balance, so
-- existing balances carry over. Members without a profile are simply absent
-- (their balance defaults to 0 when a row is later created).
insert into public.help_debt (household_id, member_id, balance_cents)
select distinct on (member_id) household_id, member_id, help_debt_cents
from public.tax_profile
order by member_id, financial_year desc;

alter table public.tax_profile drop column help_debt_cents;

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.help_debt enable row level security;

create policy "household members manage help debts" on public.help_debt
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.help_debt to authenticated;
