-- Deduction groups: many payments for one recurring expense, read as one claim.
--
-- A deductible subscription is one commitment paid many times — twelve invoices
-- for one Adobe licence — and each payment is already a deduction in its own
-- right: its own date, its own amount, its own receipt. Grouping is therefore a
-- READING of rows that already exist, not a new kind of row. The group carries a
-- name and totals its members for display; the deductions underneath stay exactly
-- what they were, which is why the tax estimate, the EOFY tab, and the Summary
-- need no change at all — they sum `deduction` rows and always did.
--
-- A group is scoped to one financial year, as a deduction is. A subscription
-- running across 30 June is two groups, one per year, because a group's total is
-- meant to BE the figure claimed for its year: a group spanning years would total
-- money from two returns, and the Deductions tab — which shows one year — could
-- only ever display part of it.
--
-- `deduction.group_id` composite-FKs (id, household_id, member_id,
-- financial_year), so a grouped deduction cannot drift from its group's
-- household, member, or year. `on delete set null (group_id)` because ungrouping
-- is not deleting: dropping a group leaves its payments standing as ordinary
-- deductions, each still claimable on its own. The column list matters — a bare
-- `set null` nulls every referencing column, and three of them are `not null`.

create table public.deduction_group (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  name text not null check (btrim(name) <> ''),
  financial_year integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  -- Lets a deduction composite-FK its group and, in the same reference, be held
  -- to the group's household, member, and financial year.
  unique (id, household_id, member_id, financial_year)
);
create index on public.deduction_group (household_id);
create index on public.deduction_group (member_id);
comment on table public.deduction_group is 'A named set of a member''s deductions for one financial year — the many payments of one recurring deductible expense, totalled for display. Grouping is presentational: each deduction underneath is claimed in its own right.';
comment on column public.deduction_group.name is 'What the recurring expense is called, e.g. "Adobe Creative Cloud"; shown on the collapsed group row.';
comment on column public.deduction_group.financial_year is 'AU financial year the group''s payments are claimed in, labelled by the ending year. A subscription running across 30 June is one group per year.';

create trigger set_updated_at before update on public.deduction_group
  for each row execute function public.set_updated_at();

alter table public.deduction_group enable row level security;

create policy "household members manage deduction groups" on public.deduction_group
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

grant select, insert, update, delete on public.deduction_group to authenticated;

-- ── The link ──────────────────────────────────────────────────────────────────

alter table public.deduction
  add column if not exists group_id uuid,
  add constraint deduction_group_fk
    foreign key (group_id, household_id, member_id, financial_year)
    references public.deduction_group (id, household_id, member_id, financial_year)
    on delete set null (group_id);

create index on public.deduction (group_id);
comment on column public.deduction.group_id is 'The group this payment belongs to, or null for a standalone deduction. The reference carries household, member, and financial year, so a payment cannot sit in a group belonging to another member or year.';
