-- An inflow either recurs on a cadence or lands once on a date.
--
-- Severance, a bonus, a gift from a relative: money that arrives once and never
-- again. A cadence cannot say that. Given `annual` and an amount, every reader
-- treats the money as arriving each year — the fortnightly budget smears it into
-- the buffer, a pay split routes a share of it, and a payslip period is measured
-- against a slice of it — so a payment that lands once is reported as a household
-- permanently ahead, then permanently behind. The recurrence is therefore a
-- choice the row makes: `schedule` states the cadence the money recurs on, or
-- `paid_on` states the single date it lands on, and exactly one of the two is
-- set.
--
-- A one-off carries none of the machinery a cadence needs. It has no interval, no
-- separate pay cadence (there is no payrun to ride), no effective dates (the
-- payment IS its date), and it is never a `wage`, an amount paid once having no
-- hours to price. It arrives on every turn of the cadence it does not have, which
-- is the only reading of `arrives_every_pay_period` that means anything here, so
-- the flag is held at its default rather than left to say something misleading.
--
-- A TAXABLE one-off also states how it is taxed. `one_off_tax_treatment` names
-- the concession — see the type's own comment — and a genuine redundancy needs
-- one more figure, `years_of_service`, because its tax-free amount is a base
-- limit plus a per-year amount for each completed year. A recurring inflow and a
-- non-taxable one-off (a gift) carry neither.
--
-- The constraints already on the table each keep their meaning through a nullable
-- `schedule` and need no rewriting, which is worth saying since each was written
-- against a schedule that was always present:
--
--   * `inflows_interval_count` — `schedule in ('every_n_weeks', 'every_n_months')`
--     is NULL for a one-off, so the CASE falls to its ELSE and requires
--     `interval_count is null`, which is what a one-off holds. This is the same
--     reading `inflows_pay_interval_count` has always relied on for a null
--     `pay_schedule`.
--   * `inflows_pay_interval_count` — keys off `pay_schedule`, which a one-off
--     leaves null, and so lands in the same ELSE.
--   * `inflows_effective_dates` — `ends_on >= starts_on` where both are set; a
--     one-off sets neither.
--   * `inflows_shape` — a one-off is never a `wage`, so it takes the ELSE branch
--     and carries `amount_cents` with no hourly rate or hours, which is exactly
--     the shape a single payment has.
--
-- `members.date_of_birth` joins them because the ETP concessional rate turns on
-- the member's age at the payment date.

-- ── Inflows ──────────────────────────────────────────────────────────────────

alter table public.inflows
  alter column schedule drop not null;

alter table public.inflows
  add column if not exists paid_on date,
  add column if not exists one_off_tax_treatment public.one_off_tax_treatment,
  add column if not exists years_of_service int;

-- An inflow states either the cadence it recurs on or the single date it lands
-- on: never both, which would be two contradictory claims about the same money,
-- and never neither, which would say nothing about when it arrives at all.
alter table public.inflows drop constraint if exists inflows_recurrence;
alter table public.inflows add constraint inflows_recurrence check (
  (schedule is not null) <> (paid_on is not null)
);

-- Everything a cadence needs is absent from a one-off, named column by column. A
-- recurring inflow is unconstrained here — the ELSE is plain `true` — and a
-- column added later is not pre-rejected on a one-off either: it takes its own
-- place in this list, or it has none.
alter table public.inflows drop constraint if exists inflows_one_off_shape;
alter table public.inflows add constraint inflows_one_off_shape check (
  case when paid_on is not null then
    interval_count is null
    and pay_schedule is null
    and pay_interval_count is null
    and starts_on is null
    and ends_on is null
    and arrives_every_pay_period
    and type <> 'wage'
  else true end
);

-- The treatment belongs to a taxable one-off and to nothing else: a recurring
-- inflow is taxed at marginal rates by definition, and a non-taxable one-off is
-- not taxed at all.
alter table public.inflows drop constraint if exists inflows_one_off_tax_treatment;
alter table public.inflows add constraint inflows_one_off_tax_treatment check (
  (one_off_tax_treatment is not null) = (paid_on is not null and taxable)
);

-- Completed years of service price the redundancy tax-free amount and mean
-- nothing to any other treatment. A comparison against a null treatment is NULL,
-- which falls to the ELSE and requires the figure to be absent.
alter table public.inflows drop constraint if exists inflows_years_of_service;
alter table public.inflows add constraint inflows_years_of_service check (
  case when one_off_tax_treatment = 'genuine_redundancy'
    then years_of_service is not null and years_of_service >= 0
    else years_of_service is null
  end
);

comment on table public.inflows is 'A projected inflow for a household — either recurring on a cadence or a one-off landing on a single date; taxable inflows are taxed under one member, non-taxable inflows add to available cash.';
comment on column public.inflows.paid_on is 'The single date a one-off inflow lands on; null on a recurring inflow, which states a `schedule` instead. Exactly one of the two is set.';
comment on column public.inflows.one_off_tax_treatment is 'The concession a taxable one-off is assessed under, which the FY estimate models rather than taxing the payment as ordinary salary; null on a recurring inflow and on a non-taxable one-off.';
comment on column public.inflows.years_of_service is 'Completed years of service behind a genuine redundancy, which price its tax-free amount (a base limit plus a per-year amount); null under every other treatment.';
comment on column public.inflows.schedule is 'Period the amount covers — the frequency the amount is EXPRESSED in, which annualisation divides by. An annual salary is annual here whatever cadence it is paid on. Null on a one-off, which states `paid_on` instead and is annualised as its whole amount in the year that date falls in.';
comment on column public.inflows.interval_count is 'Count of the every_n_weeks/every_n_months interval (weeks or months, read from the schedule); null for every fixed schedule and on a one-off, which has no schedule to interpolate.';
comment on column public.inflows.pay_schedule is 'Cadence the money ARRIVES on, when it differs from the one the amount is expressed in; null means they are the same. Sets the pay cycle a payslip period is measured against, and nothing else. Null on a one-off, which rides no payrun.';
comment on column public.inflows.pay_interval_count is 'Count of the every_n_weeks/every_n_months pay_schedule interval (weeks or months, read from pay_schedule); null for every fixed pay_schedule, when pay_schedule is null, and on a one-off.';
comment on column public.inflows.amount_cents is 'Gross amount per schedule period, for every type except wage; on a one-off, the whole payment, since the single date it lands on is the only period it covers.';
comment on column public.inflows.starts_on is 'First day the inflow is active; null means from the start of the financial year. Prorates the FY tax estimate by calendar days. Null on a one-off, whose `paid_on` is both its first and its last day.';
comment on column public.inflows.ends_on is 'Last day the inflow is active; null means through the end of the financial year. Prorates the FY tax estimate by calendar days. Null on a one-off, whose `paid_on` is both its first and its last day.';
comment on column public.inflows.arrives_every_pay_period is 'Whether the money lands on every turn of the pay cadence; false for pay that arrives only in some periods (e.g. an on-call allowance paid only for fortnights with a shift), which a payslip period then holds no expectation for. Annualisation and every projection drawn from it are unaffected. True on a one-off, which has no cadence for it to say anything about.';

-- ── Members ──────────────────────────────────────────────────────────────────
--
-- The ETP concessional rate is the lower one from preservation age onward and the
-- higher one below it, so the estimate tests the member's age at the payment date
-- against the year's preservation age. The date of birth is optional because the
-- app asks for it nowhere else, and an unset one reads as below preservation age
-- — the higher rate, so a missing figure understates the payment rather than the
-- tax on it.

alter table public.members
  add column if not exists date_of_birth date;

comment on column public.members.date_of_birth is 'The member''s date of birth; optional, and used only to test their age at a one-off payment''s date against the financial year''s preservation age, which sets the concessional rate an employment termination payment is taxed at. Unset reads as below preservation age, the higher rate.';

-- `authenticated` holds column-scoped UPDATE on the profile fields a member edits
-- rather than a blanket table grant (see `up_connected_at`), so the new column is
-- named explicitly or the client could never write it.
grant update (date_of_birth) on public.members to authenticated;
