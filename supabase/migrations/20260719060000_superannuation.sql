-- Superannuation: per-member super profile and recurring contributions.
--
-- Feeds two things later: the tax estimate (concessional contributions reduce
-- taxable income; Division 293 for high earners) and a net-worth view (the
-- balance). Money is integer cents in bigint columns. RLS on household
-- membership is the isolation boundary, and composite foreign keys on
-- (id, household_id) keep every reference inside the household. A member's super
-- balance is held as an ordinary account and linked from the profile — the same
-- balance-source pattern savings_goal uses for a synced Up saver.

-- ── Enums ──────────────────────────────────────────────────────────────────

-- The kinds of contribution the model tracks. The concessional (pre-tax) kinds
-- reduce taxable income; non-concessional and spouse are after-tax.
create type public.super_contribution_kind as enum (
  'salary_sacrifice',           -- concessional: salary sacrificed pre-tax
  'personal_deductible',        -- concessional: personal contribution claimed as a deduction
  'personal_non_concessional',  -- after-tax personal contribution
  'spouse'                      -- after-tax contribution received from the other member
);

-- How a contribution's size is expressed: a fixed dollar amount, or a
-- percentage of the member's gross salary.
create type public.super_contribution_mode as enum ('amount', 'percent');

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.super_profile (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  financial_year int not null,                        -- AU FY, ending-year label
  fund_name text,
  sg_rate_override numeric(5, 4),                      -- overrides the config SG rate when set
  linked_account_id uuid,                             -- account holding the balance; null until linked
  carry_forward_cap_cents bigint not null default 0,  -- manual unused concessional cap from prior years
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  foreign key (linked_account_id, household_id)
    references public.accounts (id, household_id) on delete set null (linked_account_id),
  unique (member_id, financial_year),
  constraint super_profile_sg_rate_override_range
    check (sg_rate_override is null or (sg_rate_override >= 0 and sg_rate_override <= 1)),
  constraint super_profile_carry_forward_nonneg
    check (carry_forward_cap_cents >= 0)
);
create index on public.super_profile (household_id);
comment on table public.super_profile is 'A member''s superannuation for a financial year: fund, SG-rate override, the account holding the balance, and any manual carry-forward concessional cap.';
comment on column public.super_profile.sg_rate_override is 'Employer super guarantee rate for this member when it differs from the config default; null uses the config rate.';
comment on column public.super_profile.linked_account_id is 'Optional account whose balance_cents is this member''s super balance; null when not yet linked.';
comment on column public.super_profile.carry_forward_cap_cents is 'Manually entered unused concessional cap carried forward from up to 5 prior years (eligible when total super balance < $500,000); raises the effective cap for the year.';

create table public.super_contribution (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  member_id uuid not null,
  financial_year int not null,                    -- AU FY, ending-year label
  kind public.super_contribution_kind not null,
  mode public.super_contribution_mode not null,
  amount_cents bigint,                            -- set when mode = 'amount'
  percent_bp int,                                 -- basis points of gross salary; set when mode = 'percent'
  frequency public.frequency not null,            -- cadence, normalised to a year like inflows
  interval_weeks int,                             -- set only when frequency = 'every_n_weeks'
  fhss_eligible boolean not null default false,   -- counts toward the First Home Super Saver scheme
  contributor_member_id uuid,                     -- the paying member for a spouse contribution
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,
  foreign key (contributor_member_id, household_id)
    references public.members (id, household_id) on delete set null (contributor_member_id),
  constraint super_contribution_amount_xor_percent check (
    case mode
      when 'amount' then amount_cents is not null and amount_cents >= 0 and percent_bp is null
      when 'percent' then percent_bp is not null and percent_bp >= 0 and amount_cents is null
    end
  ),
  constraint super_contribution_interval_weeks check (
    case frequency
      when 'every_n_weeks' then interval_weeks is not null and interval_weeks >= 1
      else interval_weeks is null
    end
  ),
  constraint super_contribution_contributor_only_spouse
    check (contributor_member_id is null or kind = 'spouse')
);
create index on public.super_contribution (household_id);
create index on public.super_contribution (member_id);
comment on table public.super_contribution is 'A recurring superannuation contribution for a member and financial year: a fixed amount or a percent of gross salary, on a schedule normalised to a year.';
comment on column public.super_contribution.percent_bp is 'Basis points of the member''s gross salary (e.g. 500 = 5.00%) when mode = percent; null otherwise.';
comment on column public.super_contribution.fhss_eligible is 'Whether this voluntary contribution counts toward the First Home Super Saver scheme.';
comment on column public.super_contribution.contributor_member_id is 'For a spouse contribution, the member who makes (and may claim the offset for) it; null otherwise.';

-- ── updated_at triggers ──────────────────────────────────────────────────────

create trigger set_updated_at before update on public.super_profile
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.super_contribution
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.super_profile enable row level security;
alter table public.super_contribution enable row level security;

create policy "household members manage super profiles" on public.super_profile
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage super contributions" on public.super_contribution
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.super_profile to authenticated;
grant select, insert, update, delete on public.super_contribution to authenticated;
