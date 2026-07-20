-- Confirmed pay split per account.
--
-- Records the fortnightly pay split the household has confirmed as set in Up for
-- an account, so the Splits tab can surface drift from the recommended split and
-- prompt a re-confirm. The confirmation is app-side today; the "configured split"
-- is a source-agnostic concept, so if Up's API ever exposes the real configured
-- split, that becomes the source and this manual confirmation step falls away.
-- One row per account, isolated to the household by RLS and the composite FK on
-- (id, household_id) — the same cross-household guard the rest of the ledger uses.

create table public.pay_split (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  account_id uuid not null,
  confirmed_fortnightly_cents bigint not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, account_id),
  foreign key (account_id, household_id)
    references public.accounts (id, household_id) on delete cascade
);
create index on public.pay_split (household_id);
comment on table public.pay_split is 'The fortnightly pay split the household has confirmed as set in Up for an account; compared against the recommended split to surface drift. App-side source today, one row per account.';

create trigger set_updated_at before update on public.pay_split
  for each row execute function public.set_updated_at();

alter table public.pay_split enable row level security;
create policy "household members manage pay splits" on public.pay_split
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

grant select, insert, update, delete on public.pay_split to authenticated;
