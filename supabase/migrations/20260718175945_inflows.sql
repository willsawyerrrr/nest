-- Inflows: money in, split by taxability. A household owns many inflows; each is
-- either a taxable income (salary / wage / other, tagged to a member and fed to
-- the tax estimate) or a non-taxable inflow (e.g. a reimbursement) that adds to
-- available cash and needs no member tag. Frequency is shared with budget lines.

-- ── Enums ──────────────────────────────────────────────────────────────────

alter type public.income_type rename to inflow_type;
alter type public.inflow_type add value 'reimbursement';

alter type public.income_schedule rename to frequency;
alter type public.frequency add value 'quarterly';
alter type public.frequency add value 'biannual';

-- ── Table ────────────────────────────────────────────────────────────────────

alter table public.income rename to inflows;

alter table public.inflows rename constraint income_pkey to inflows_pkey;
alter table public.inflows rename constraint income_id_household_id_key to inflows_id_household_id_key;
alter table public.inflows rename constraint income_household_id_fkey to inflows_household_id_fkey;
alter table public.inflows rename constraint income_member_id_household_id_fkey to inflows_member_id_household_id_fkey;
alter index public.income_household_id_idx rename to inflows_household_id_idx;
alter index public.income_member_id_idx rename to inflows_member_id_idx;

alter table public.inflows add column taxable boolean not null default true;

-- Non-taxable inflows may omit the member tag; taxable ones require it. The
-- composite FK (member_id, household_id) is MATCH SIMPLE, so a null member_id
-- skips the reference check.
alter table public.inflows alter column member_id drop not null;
alter table public.inflows add constraint inflows_taxable_member check (
  taxable = false or member_id is not null
);

-- Wage inflows carry an hourly rate and hours; every other type carries a flat
-- per-period amount.
alter table public.inflows drop constraint income_shape;
alter table public.inflows add constraint inflows_shape check (
  case type
    when 'wage' then
      hourly_rate_cents is not null and hours_per_period is not null and amount_cents is null
    else
      amount_cents is not null and hourly_rate_cents is null and hours_per_period is null
  end
);

comment on table public.inflows is 'A projected recurring inflow for a household; taxable inflows are taxed under one member, non-taxable inflows add to available cash.';
comment on column public.inflows.taxable is 'Whether the inflow is assessable income; only taxable inflows feed the tax estimate.';
comment on column public.inflows.member_id is 'Member the inflow is taxed under; required when taxable, null otherwise.';
comment on column public.inflows.amount_cents is 'Gross amount per frequency period, for salary/other/reimbursement.';
comment on column public.inflows.hourly_rate_cents is 'Hourly rate, for wage inflows.';
comment on column public.inflows.hours_per_period is 'Hours per frequency period, for wage inflows.';

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter policy "household members manage income" on public.inflows
  rename to "household members manage inflows";
