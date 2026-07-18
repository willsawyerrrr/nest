-- Budget, savings goals, and temporary items: the plan-only, fortnightly spending
-- plan for a household.
--
-- A budget line allocates a recurring amount to a named purpose within one fixed
-- group. A savings goal is a target-driven target that Savings/Investments lines
-- fund (many lines to one goal). A temporary item is a date-driven outflow that
-- runs until its target date, with an external source owning the real balance.
--
-- Isolation matches the ledger: RLS on household membership, plus composite
-- foreign keys on (id, household_id) that make cross-household references
-- impossible.

-- ── Enums ──────────────────────────────────────────────────────────────────

create type public.budget_group as enum ('needs', 'wants', 'discretionary', 'savings', 'investments');

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.savings_goal (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  target_amount_cents bigint not null,
  target_date date,
  current_balance_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index on public.savings_goal (household_id);
comment on table public.savings_goal is 'A persistent savings target; funded by many budget lines, progress projected from current balance and summed contributions.';
comment on column public.savings_goal.current_balance_cents is 'Balance saved so far, entered manually until sourced from real balances via ingestion.';

create table public.budget_line (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  line_group public.budget_group not null,
  name text not null,
  amount_cents bigint not null,
  frequency public.frequency not null,
  goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (goal_id, household_id)
    references public.savings_goal (id, household_id) on delete set null (goal_id),
  constraint budget_line_goal_group check (
    goal_id is null or line_group in ('savings', 'investments')
  )
);
create index on public.budget_line (household_id);
comment on table public.budget_line is 'A planned recurring allocation within one fixed group; Savings/Investments lines may fund a goal.';
comment on column public.budget_line.goal_id is 'Savings goal this line funds; only Savings/Investments lines may set it.';

create table public.temporary_item (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  contribution_cents bigint not null,
  target_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.temporary_item (household_id);
comment on table public.temporary_item is 'A date-driven fortnightly outflow that runs until its target date; an external source owns the real balance.';
comment on column public.temporary_item.contribution_cents is 'Fortnightly amount put toward the item.';

-- ── updated_at triggers ──────────────────────────────────────────────────────

create trigger set_updated_at before update on public.savings_goal
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.budget_line
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.temporary_item
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.savings_goal enable row level security;
alter table public.budget_line enable row level security;
alter table public.temporary_item enable row level security;

create policy "household members manage savings goals" on public.savings_goal
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage budget lines" on public.budget_line
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage temporary items" on public.temporary_item
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.savings_goal to authenticated;
grant select, insert, update, delete on public.budget_line to authenticated;
grant select, insert, update, delete on public.temporary_item to authenticated;
