-- Separate how an inflow's amount is EXPRESSED from how often it ARRIVES.
--
-- A salary is defined as an annual number and paid fortnightly. Both facts are
-- real and neither derives from the other, so the row holds each: `schedule` +
-- `amount_cents` keep meaning exactly what they mean — the amount and the period
-- it covers, so `annual` + 13_000_000 is a $130,000 salary held losslessly — and
-- the new `pay_schedule` + `pay_interval_count` carry the cadence the money lands
-- on. Null `pay_schedule` means the money arrives on the same cadence the amount
-- is expressed in, which is every existing row's behaviour, so nothing is
-- backfilled.
--
-- Annualisation stays on `schedule`: the FY tax estimate, the budget's
-- fortnightly/annual normalisation, and pay splits all ask what the amount comes
-- to over a year, which the pay cadence does not change. The pay cadence answers
-- the other question — how long one turn of the pay cycle is and how many turns a
-- year holds — which is what a payslip's period is measured against. A 14-day
-- period against a $130,000 annual amount paid fortnightly is one whole turn
-- expecting $5,000.00; were `annual` read as the arrival cadence it would be part
-- of a 365-day turn expecting $4,986.30 instead.

alter table public.inflows
  add column pay_schedule public.frequency,
  add column pay_interval_count int;

-- The pay interval keeps lockstep with the pay schedule exactly as
-- `inflows_interval_count` does with `schedule`: present and positive for the two
-- interpolated cadences, null for every fixed cadence and for no pay cadence at
-- all (a null `pay_schedule` makes the IN test null, which falls to the ELSE).
alter table public.inflows add constraint inflows_pay_interval_count check (
  case
    when pay_schedule in ('every_n_weeks', 'every_n_months')
      then pay_interval_count is not null and pay_interval_count >= 1
    else pay_interval_count is null
  end
);

comment on column public.inflows.schedule is 'Period the amount covers — the frequency the amount is EXPRESSED in, which annualisation divides by. An annual salary is annual here whatever cadence it is paid on.';
comment on column public.inflows.pay_schedule is 'Cadence the money ARRIVES on, when it differs from the one the amount is expressed in; null means they are the same. Sets the pay cycle a payslip period is measured against, and nothing else.';
comment on column public.inflows.pay_interval_count is 'Count of the every_n_weeks/every_n_months pay_schedule interval (weeks or months, read from pay_schedule); null for every fixed pay_schedule and when pay_schedule is null.';
