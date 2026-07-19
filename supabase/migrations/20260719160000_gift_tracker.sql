-- Gift tracker and derived budget lines.
--
-- A budget line's amount is normally typed by hand. It can instead be *derived*:
-- rolled up from an itemised source so there is one source of truth and no drift
-- between the line and its detail. `budget_line.derived_source` names that source
-- (null = an ordinary manual line); the summary math honours it in a later slice.
-- The mechanism is generic and extensible — gifts is the first source, health /
-- medication is a planned second.
--
-- The gift tracker is the first consumer: plan a spend per recipient × occasion,
-- then record the actual purchases against it. Isolation matches the ledger — RLS
-- on household membership, plus composite foreign keys on (id, household_id) that
-- make cross-household references impossible.

-- ── Enums ──────────────────────────────────────────────────────────────────

-- The itemised sources a budget line's amount can be derived from. Extensible:
-- new sources (e.g. medication) are added as they land.
create type public.budget_derived_source as enum ('gift');

-- ── budget_line: derived-source column ───────────────────────────────────────

alter table public.budget_line
  add column derived_source public.budget_derived_source;
comment on column public.budget_line.derived_source is 'When set, the line''s amount is rolled up from this itemised source rather than typed; null is an ordinary manual line.';

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.gift_recipient (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index on public.gift_recipient (household_id);
comment on table public.gift_recipient is 'A named person the household budgets gifts for.';

create table public.gift_occasion (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  occasion_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index on public.gift_occasion (household_id);
comment on table public.gift_occasion is 'A named gifting occasion (e.g. Christmas, a birthday) with an optional date.';

create table public.gift_budget (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  recipient_id uuid not null,
  occasion_id uuid not null,
  budgeted_amount_cents bigint not null default 0 check (budgeted_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (recipient_id, household_id)
    references public.gift_recipient (id, household_id) on delete cascade,
  foreign key (occasion_id, household_id)
    references public.gift_occasion (id, household_id) on delete cascade,
  unique (recipient_id, occasion_id),
  unique (id, household_id)
);
create index on public.gift_budget (household_id);
comment on table public.gift_budget is 'One planned gift spend per recipient × occasion; purchases track actual spend against it.';

create table public.gift_purchase (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  gift_budget_id uuid not null,
  amount_cents bigint not null check (amount_cents >= 0),
  description text not null default '',
  purchased_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (gift_budget_id, household_id)
    references public.gift_budget (id, household_id) on delete cascade
);
create index on public.gift_purchase (household_id);
create index on public.gift_purchase (gift_budget_id);
comment on table public.gift_purchase is 'An actual gift purchase assigned to a gift budget: amount, description, and date.';

-- ── updated_at triggers ──────────────────────────────────────────────────────

create trigger set_updated_at before update on public.gift_recipient
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.gift_occasion
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.gift_budget
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.gift_purchase
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.gift_recipient enable row level security;
alter table public.gift_occasion enable row level security;
alter table public.gift_budget enable row level security;
alter table public.gift_purchase enable row level security;

create policy "household members manage gift recipients" on public.gift_recipient
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage gift occasions" on public.gift_occasion
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage gift budgets" on public.gift_budget
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage gift purchases" on public.gift_purchase
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.gift_recipient to authenticated;
grant select, insert, update, delete on public.gift_occasion to authenticated;
grant select, insert, update, delete on public.gift_budget to authenticated;
grant select, insert, update, delete on public.gift_purchase to authenticated;
