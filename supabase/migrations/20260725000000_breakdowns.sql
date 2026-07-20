-- User-created breakdowns: itemised lists that roll up into a single budget line.
--
-- A breakdown is a household-scoped, named, itemised list assigned to a budget
-- group; its items roll up into one derived `budget_line`, so the line and its
-- detail are a single source of truth and never drift. Breakdowns genericise the
-- fixed derived-source mechanism into data — gifts and medications are breakdown
-- rows the household creates, not hardcoded enum cases. `kind` selects the editor
-- and the roll-up source: a `generic` breakdown reads `breakdown_item`; a `gift`
-- breakdown keeps its bespoke `gift_*` tables.
--
-- This slice is additive: the tables and `budget_line.breakdown_id` land alongside
-- the existing `budget_derived_source` enum and `budget_line.derived_source`
-- column, which keep working until the app switches over. Isolation matches the
-- ledger — RLS on household membership, plus composite foreign keys on
-- (id, household_id) that make cross-household references impossible.

-- ── Enums ──────────────────────────────────────────────────────────────────

-- Selects a breakdown's editor and roll-up source, not a per-instance type:
-- 'generic' rolls up `breakdown_item` rows; 'gift' rolls up the `gift_*` tables.
create type public.breakdown_kind as enum ('generic', 'gift');

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.breakdown (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  line_group public.budget_group not null,
  kind public.breakdown_kind not null default 'generic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index on public.breakdown (household_id);
comment on table public.breakdown is 'A household-created itemised list whose items roll up into one derived budget line; kind selects the editor and roll-up source.';
comment on column public.breakdown.name is 'The rolled-up line''s name.';
comment on column public.breakdown.line_group is 'The budget group the rolled-up line belongs to.';
comment on column public.breakdown.kind is 'Selects the editor and roll-up source: generic reads breakdown_item; gift reads the gift_* tables.';

create table public.breakdown_item (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  breakdown_id uuid not null,
  name text not null,
  amount_cents bigint not null,
  frequency public.frequency not null,
  interval_weeks int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (breakdown_id, household_id)
    references public.breakdown (id, household_id) on delete cascade,
  constraint breakdown_item_interval_weeks check (
    case frequency
      when 'every_n_weeks' then interval_weeks is not null and interval_weeks >= 1
      else interval_weeks is null
    end
  )
);
create index on public.breakdown_item (household_id);
comment on table public.breakdown_item is 'A line item of a generic breakdown, carrying an amount on a frequency; a gift breakdown owns none (its items live in gift_budget).';
comment on column public.breakdown_item.interval_weeks is 'Weeks between allocations for the every_n_weeks frequency; null for every other frequency.';

-- ── budget_line: breakdown-owned derived line ────────────────────────────────

alter table public.budget_line
  add column breakdown_id uuid,
  add constraint budget_line_breakdown_id_household_id_fkey
    foreign key (breakdown_id, household_id)
    references public.breakdown (id, household_id) on delete cascade;
comment on column public.budget_line.breakdown_id is 'When set, the line is a derived line owned by this breakdown, its amount rolled up from the breakdown''s items; null is an ordinary manual line.';

-- ── updated_at triggers ──────────────────────────────────────────────────────

create trigger set_updated_at before update on public.breakdown
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.breakdown_item
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.breakdown enable row level security;
alter table public.breakdown_item enable row level security;

create policy "household members manage breakdowns" on public.breakdown
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage breakdown items" on public.breakdown_item
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.breakdown to authenticated;
grant select, insert, update, delete on public.breakdown_item to authenticated;

-- ── Backfill: one gift breakdown per household with a gift-derived line ───────

-- Each household running the gift tracker has a single `derived_source = 'gift'`
-- budget line; mint one gift breakdown per such household (named "Gifts", taking
-- the line's group) and point the line at it, so the existing gift line is a
-- breakdown-owned derived line from here on.
with new_bd as (
  insert into public.breakdown (household_id, name, line_group, kind)
  select household_id, 'Gifts', line_group, 'gift'
  from public.budget_line where derived_source = 'gift'
  returning id, household_id
)
update public.budget_line bl
  set breakdown_id = nb.id
  from new_bd nb
  where bl.household_id = nb.household_id and bl.derived_source = 'gift';
