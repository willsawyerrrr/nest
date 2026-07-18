-- Income and tax profiles: a household's projected incomes and each member's
-- per-financial-year tax inputs.
--
-- A household owns many incomes; each income is attributed to one member for
-- tax, because tax is assessed per person in AU. Attribution is a tax tag, not
-- a permission: every household member can manage every row. Isolation is the
-- same as the ledger — RLS on household membership, plus composite foreign keys
-- on (id, household_id) that make cross-household references impossible.

-- ── Enums ──────────────────────────────────────────────────────────────────

create type public.income_type as enum ('salary', 'wage', 'other');
create type public.income_schedule as enum ('weekly', 'fortnightly', 'monthly', 'annual');
create type public.tax_residency as enum ('resident', 'foreign_resident');

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.income (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  name text not null,
  type public.income_type not null,
  schedule public.income_schedule not null,
  amount_cents bigint,
  hourly_rate_cents bigint,
  hours_per_period numeric(8, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  constraint income_shape check (
    case type
      when 'wage' then
        hourly_rate_cents is not null and hours_per_period is not null and amount_cents is null
      else
        amount_cents is not null and hourly_rate_cents is null and hours_per_period is null
    end
  )
);
create index on public.income (household_id);
create index on public.income (member_id);
comment on table public.income is 'A projected recurring income for a household, taxed under one member.';
comment on column public.income.amount_cents is 'Gross amount per schedule period, for salary/other.';
comment on column public.income.hourly_rate_cents is 'Hourly rate, for wage income.';
comment on column public.income.hours_per_period is 'Hours per schedule period, for wage income.';

create table public.tax_profile (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  financial_year int not null,
  residency public.tax_residency not null default 'resident',
  has_private_hospital_cover boolean not null default false,
  help_debt_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  unique (member_id, financial_year)
);
create index on public.tax_profile (household_id);
comment on table public.tax_profile is 'Per-member, per-financial-year tax inputs for the tax engine.';
comment on column public.tax_profile.financial_year is 'AU financial year, labelled by its ending year (e.g. 2027).';

-- ── updated_at triggers ──────────────────────────────────────────────────────

create trigger set_updated_at before update on public.income
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.tax_profile
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.income enable row level security;
alter table public.tax_profile enable row level security;

create policy "household members manage income" on public.income
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage tax profiles" on public.tax_profile
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.income to authenticated;
grant select, insert, update, delete on public.tax_profile to authenticated;
