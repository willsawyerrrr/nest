-- Whether an inflow's money lands in every pay period, or only in some of them.
--
-- On-call pay is paid alongside the fortnightly payrun, but only for the
-- fortnights a shift was actually worked. A cadence cannot say that: any cadence
-- claims the money arrives every turn, so a fortnight with no shift reads as
-- below plan by the whole on-call expectation and a fortnight with one reads as
-- above plan, because the expectation was smoothed across every fortnight.
-- Neither is a real discrepancy. The app models per-period payslip totals and no
-- roster, so it cannot know WHICH fortnights carry a shift — and this flag is how
-- it stops pretending it does.
--
-- It changes nothing about the projection. `schedule` + `amount_cents` still say
-- what the money comes to over a period, and everything that annualises them is
-- untouched: the FY tax estimate and its effective-date proration, the budget's
-- fortnightly/annual normalisation, the summary's available cash, and the pay
-- splits drawn from it. On-call worth roughly $6,600 a year still projects
-- roughly $6,600 a year. The flag sets one thing: a payslip period holds no
-- expectation for such an inflow, so its earnings lines report no expected figure
-- and no variance rather than a smoothed one, and the year is where the household
-- reads whether the projection is holding up.
--
-- Default true, so every existing row keeps arriving every period and nothing is
-- backfilled. Not null, because "some periods or all of them" is always one or the
-- other. Like `attracts_super`, it is a taxable-inflow concern — only a taxable
-- inflow is reconciled against a payslip — and is stored true for a non-taxable
-- one so switching it back to taxable starts from the ordinary default.

alter table public.inflows
  add column arrives_every_pay_period boolean not null default true;

comment on column public.inflows.arrives_every_pay_period is 'Whether the money lands on every turn of the pay cadence; false for pay that arrives only in some periods (e.g. an on-call allowance paid only for fortnights with a shift), which a payslip period then holds no expectation for. Annualisation and every projection drawn from it are unaffected.';
