# Australian income tax modelling

The tax engine is a pure function: given a member's financial-year figures and the
`TaxYearConfig` for that year, it returns a breakdown of liability and compares it
to tax already withheld. No hardcoded rates in code — all parameters live in a
versioned config per financial year, because AU rates and thresholds change yearly.

## Financial year

- AU FY runs 1 July – 30 June, labelled by the ending year (e.g. `FY2027` =
  1 Jul 2026 – 30 Jun 2027).
- Every computed value is scoped to a financial year.

## Effective-dated income

Each inflow may carry an optional effective start (`starts_on`) and/or end
(`ends_on`) date; both null means it applies for the whole financial year. When
estimating tax, `estimateHouseholdTax` prorates each income's annual gross by the
fraction of the financial year its window is active, counted in **inclusive
calendar days** (`activeFractionOfFinancialYear`). Income that changes partway
through a year is therefore modelled correctly: a mid-year pay rise is two dated
inflows — the old rate ending on its last day and the new rate starting the next
day — and because days are counted inclusively, adjacent windows sum to exactly
the whole year. The steady-rate `annualGrossCents` is unchanged; it remains the
per-inflow display figure and the base for percent-of-salary super contributions,
which apply to the current rate rather than the part-year figure.

FY-share proration is a tax-estimate concept only. A non-taxable inflow carries
the same `starts_on` / `ends_on` dates but never reaches the tax engine; the
fortnightly budget gates it fully in or out by whether it is active now (see
[`budget-and-savings.md`](budget-and-savings.md)).

## One-off payments and termination concessions

An inflow is either **recurring** — it states the cadence it arrives on — or
**one-off** — it states the single date it lands on (`paid_on`). A one-off is money
that arrives once: severance, a bonus, a gift. It is never annualised and never
prorated by an effective window; `annualGrossCents` returns its whole amount when
`paid_on` falls inside the financial year and nothing at all when it falls outside,
because a payment lands on a day rather than accruing over one.

A taxable one-off carries a **tax treatment**, so a redundancy is not taxed as
though it were salary. `splitOneOffPayment(payment, otherTaxableIncomeCents, config)`
splits one payment into the parts the estimate treats differently:

| Treatment | Tax-free | Assessable | Concessional (capped rate) |
| --- | --- | --- | --- |
| `ordinary` | nil | the whole payment | none — marginal rates throughout |
| `genuineRedundancy` | `base_limit_cents + per_year_of_service_cents ×` completed years, capped at the payment | the rest | the assessable part up to the **ETP cap** |
| `employmentTermination` | nil | the whole payment | up to the lesser of the ETP cap and the **whole-of-income cap** less the member's other taxable income |
| `unusedLeave` | nil | the whole payment | the whole payment, at `unused_leave_max_rate`, uncapped in amount |

A genuine redundancy is an **excluded** payment, so only the ETP cap bounds it; every
other ETP is **non-excluded**, so a high salary can shrink its concession to nothing.
Completed years of service are floored to whole years at or above zero, and an absent
figure counts as none. The concessional rate is `at_preservation_age_rate` when the
member was at or above the year's preservation age on the payment date and
`below_preservation_age_rate` otherwise — an unknown date of birth reads as below.

> **The config's rates exclude the 2% Medicare levy.** The ATO quotes the ETP rates
> as 32% / 17% / 47% and the unused-leave maximum as 32%; each of those is the
> config's rate **plus** the levy. The concessional amount sits in taxable income, so
> the `medicareLevy` line already charges the levy on it, and repeating it in the rate
> would charge it twice.

### The concession is delivered as an offset

The assessable part of every one-off joins taxable income as
`employment_termination_cents` — deliberately, because it is assessable income like
any other and must lift income for the LITO taper, the Medicare levy, the surcharge,
HELP repayment income, and Division 293, all of which assess taxable income.

The concession is then delivered as `one_off_offset_cents`, by the ATO's difference
method, per concession:

```
offset = income_tax(taxable_income)
       − income_tax(taxable_income − concessional_cents)
       − round(concessional_cents × rate)
```

Several concessions in one year are peeled off the top in order, so each is measured
against the income actually sitting under it. Each is floored at zero: the capped rate
is a **maximum**, so where the member's marginal rate is already below it the marginal
rate stands and the concession is worth nothing. The offset is applied alongside LITO
— `net_income_tax = max(0, income_tax − lito − one_off_offset)` — which makes it
**non-refundable**: it can never create a refund on its own, and it leaves the Medicare
levy, the surcharge, the HELP repayment, and Division 293 untouched.

### One-off money is kept out of the fortnightly plan

`MemberTaxEstimate` and `HouseholdTaxEstimate` report `annual_one_off_gross_cents` and
`annual_one_off_after_tax_cents` — the latter the gross less the liability the one-offs
themselves add, computed by running the member twice and differencing, the same shape
as the salary-sacrifice what-if.

The annual and fortnightly figures **deliberately disagree** about that money. The
annual figures are whole-year truths and include it; the fortnightly figures are
derived from the same year net of it, so `fortnightly_gross_cents × 26` falls short of
`annual_gross_cents` by the one-off gross. Money that lands once has no fortnightly
share to plan against — smearing a redundancy across 26 fortnights would promise cash
in 25 of them that never arrives — so the budget plans against recurring money and the
one-off is shown as the separate figure it is.

> **Termination-concession simplifications.** The part of a payment above the ETP cap
> is left to the marginal brackets rather than lifted to `above_cap_rate`: the top
> bracket already reaches that rate at the incomes at which the cap binds, and the
> offset mechanism can only reduce tax, never add it. The whole-of-income headroom is
> measured against the member's recurring taxable income (gross less deductions and
> concessional super) plus the assessable part of any earlier one-off in the same year.
> The family-assessed Medicare levy surcharge is held constant across the two runs
> behind `annual_one_off_after_tax_cents`, so a one-off large enough to move the
> household into a surcharge tier has that rise counted in the total liability but not
> attributed to the payment.

## Inputs (per member, per FY)

- Assessable income: salary/wages, business, investment, other, and the assessable
  part of every one-off payment (`employment_termination_cents` — see
  [One-off payments](#one-off-payments-and-termination-concessions)). Each taxable
  inflow's annualised gross at its steady rate, `inflows.schedule` being what
  annualising divides by. Neither the cadence the money arrives on (`pay_schedule`)
  nor whether it arrives on every turn of that cadence
  (`arrives_every_pay_period`) has any part in it: an on-call allowance worth $6,600
  a year is $6,600 of assessable income however few of the year's fortnights it
  lands in. Those two columns bear on a payslip period's expectations alone — see
  [`payslips.md`](payslips.md#pay-that-lands-in-only-some-periods).
- Deductions (work-related, etc.).
- Residency status (resident vs non-resident brackets differ).
- Claims tax-free threshold (affects withholding expectations).
- Private hospital cover held (Medicare levy surcharge).
- HECS/HELP debt balance — a member's single standing balance from the
  `help_debt` table (edited on the HELP debt tab), not the tax profile.
- Concessional (pre-tax) super contributions — salary sacrifice and personal
  deductible.
- Tax withheld to date (from payslips) — each slip's whole printed tax total, PAYG
  income tax plus any STSL study-loan component, whether or not the slip itemises
  the two as tax lines; see
  [`payslips.md`](payslips.md#tax-withheld-is-the-slips-tax-total). A slip counts
  toward the year its pay **landed** in, not the year the work fell in — see
  [`payslips.md`](payslips.md#a-payslip-belongs-to-the-year-its-pay-landed-in).

## Computation pipeline

1. **Taxable income** = assessable income − deductions − concessional super
   contributions (salary sacrifice and personal deductible both reduce it).
2. **Income tax** = apply marginal brackets from `TaxYearConfig`.
3. **Offsets** — subtract the Low Income Tax Offset (LITO) and the
   employment-termination concession offset. Offsets reduce tax payable but not
   below zero, and reach no further than income tax.
4. **Medicare levy** — base rate (2%) with low-income reduction thresholds.
5. **Medicare levy surcharge** — assessed on the household's **combined** income,
   not per person. The tier rate is chosen by summed surcharge income against the
   **family** thresholds (each tier's family floor raised by
   `family_dependent_child_increment_cents` for every dependent child after the
   first); a member then pays that rate on their **own** surcharge income, and is
   exempt only if they themselves hold private hospital cover — so both partners
   must be covered to avoid it entirely. A single-member household falls back to
   the single-person thresholds. Surcharge income adds the concessional super
   contributions back to taxable income. The engine assesses this in two passes at
   the household layer (`estimateHouseholdTax`): a first pass computes each
   member's surcharge income, the family assessment (`familyMedicareLevySurcharge`)
   picks the rate, and a second pass injects each member's surcharge via
   `computeTax`'s `medicareLevySurchargeCentsOverride`. The live estimate assumes
   **no dependent children** (there is no persisted field); the Tax tab's what-if
   panel lets the household explore other counts.
6. **HELP/HECS repayment** — income-tested compulsory repayment on repayment
   income (which likewise adds concessional super contributions back). From
   1 July 2025 (FY2026 onward) it is **marginal**: a rate applies to repayment
   income within each band above the first band's floor, and the total is capped
   at a maximum fraction of the whole repayment income (the cap binds only at high
   incomes, reproducing the ATO's whole-of-income top band). Capped at the
   outstanding debt.
7. **Division 293** — for high earners, an extra 15% on the lesser of the
   concessional contributions and the amount by which Division 293 income
   (taxable income + concessional contributions) exceeds the $250,000 threshold.
8. **Total liability** = income tax − offsets + Medicare levy + surcharge +
   HELP repayment + Division 293.
9. **Balance** = total liability − tax withheld. Positive = amount owing;
   negative = estimated refund. The liability at step 8 includes the HELP
   repayment, so the withheld figure netted against it is the slip's tax total —
   PAYG **and** the STSL component that pays that repayment. Netting the PAYG line
   alone would overstate the amount owing by every dollar of STSL withheld. The
   split is what a slip's per-component variance is measured against instead:
   `helpRepaymentCents` for an STSL line, the liability less it for a PAYG one (see
   [`payslips.md`](payslips.md#tax-withheld-is-the-slips-tax-total)).

> **Super-income simplification.** Surcharge, HELP repayment, and Division 293
> income are taken as taxable income plus concessional contributions; reportable
> fringe benefits and net investment losses are not yet modelled.

## Super contribution caps and co-contribution

Alongside the liability pipeline, `@nest/tax` exposes super helpers driven by
the same versioned config. Concessional (salary sacrifice + personal deductible)
and personal non-concessional contributions are annualised per member and
compared against their caps: the concessional cap is `concessional_cap_cents`
plus the member's manual carry-forward, the non-concessional cap is
`non_concessional_cap_cents` (bring-forward up to 3× is surfaced as a note, not
modelled).

`superCoContribution(personalNonConcessionalCents, totalIncomeCents, config)`
estimates the government co-contribution: 50c per $1 of eligible personal
non-concessional contributions up to `co_contribution.max_cents`, tapering
linearly to nil from the lower to the higher income threshold; nil at or above
the higher threshold or with no eligible contributions.

> **Co-contribution simplification.** The remaining eligibility conditions (age
> under 71, the 10%-employment-income test, and a total super balance under the
> general transfer balance cap) are assumed met, and `totalIncomeCents` is
> approximated as the member's annual assessable income.

## Retirement projection

`netAnnualSuperContributionByMember` (in the PWA's `lib/tax`) resolves each
member's annual contribution landing in super, net of the 15% contributions tax:
concessional contributions and the employer super guarantee (`guarantee_rate ×`
gross salary) are taxed in the fund; personal non-concessional contributions and
the government co-contribution are made from after-tax money and added untaxed.

`projectSuperBalance` (in `@nest/plan`) is pure retirement math: it compounds
the current balance at the nominal return over the years to retirement and adds
the contributions as a growing annuity (each year's contribution grows at the
contribution-growth rate, invested at the nominal return), then deflates the
nominal total by inflation for a today's-dollars figure. All amounts are integer
cents; `years` is passed in for determinism.

> **Client-side assumptions.** The return, inflation, contribution-growth, and
> retirement-age assumptions, and each member's current age, are UI inputs held
> in localStorage — they are not persisted to the database. The retirement age
> defaults to the config's `preservation_age`.

## HELP/HECS indexation and payoff projection

A HELP/HECS balance is indexed once a year, on 1 June, by
`help_repayment.indexation_rate` — the minimum of the CPI and WPI movements,
sourced from the versioned per-FY config (never hardcoded). `computeTax` assesses
a balance already indexed, so indexation matters only when projecting a debt
forward.

`projectHelpPayoff(balanceCents, repaymentIncomeCents, config, startFinancialYear,
maxYears = 40)` (in `@nest/tax`) estimates the financial year a debt clears. Each
year follows the ATO order of operations: the opening balance is **indexed on
1 June before** that year's compulsory repayment is credited, the repayment is
computed against the indexed balance and subtracted (floored at zero), and the
year is recorded in the returned `schedule`. It stops when the balance clears
(reporting `paidOffFinancialYear` and `yearsToPayOff`) or when a year's closing
balance no longer falls below its opening balance — indexation outpacing
repayment, so the debt never clears — and runs at most `maxYears` (40) years. A
non-positive balance returns an empty schedule.

The PWA's Tax tab renders a per-member payoff line beneath the HELP/HECS row for
each member with a positive HELP balance (`helpPayoffByMember` /
`helpPayoffForBreakdown` in `lib/tax`), reading the member's repayment income from
their tax breakdown.

> **Payoff-projection simplifications.** Repayment income is held constant across
> every projected year at the member's current estimate — real income (and so the
> repayment) varies year to year. The latest financial year's `config` in
> `configsByYear` is reused for every year beyond it, so future indexation and
> repayment thresholds are assumed unchanged. Voluntary repayments, new
> borrowings, and any interaction with super or investment growth are excluded.

## `TaxYearConfig` shape (versioned)

```
financial_year: FY2027
residency: resident
brackets:            # ordered, marginal
  - { up_to_cents: 1820000, rate: 0.00 }
  - { up_to_cents: 4500000, rate: 0.16 }
  - { up_to_cents: 13500000, rate: 0.30 }
  - { up_to_cents: 19000000, rate: 0.37 }
  - { up_to_cents: null,     rate: 0.45 }   # top bracket
medicare_levy:
  rate: 0.02
  low_income_threshold_cents: ...
  phase_in_rate: 0.10
medicare_levy_surcharge:
  tiers: [ { income_over_cents, family_income_over_cents, rate } ]
  family_dependent_child_increment_cents: ...   # +per dependent child after the first
lito:
  max_offset_cents: ...
  taper_rules: [ ... ]
help_repayment:
  marginal_bands: [ { income_over_cents, rate } ]  # marginal, ordered by floor
  max_repayment_rate: 0.10                          # cap on whole repayment income
  indexation_rate: 0.035                            # annual indexation (1 June), for the payoff projection
super:
  guarantee_rate: 0.12
  concessional_cap_cents: ...
  contributions_tax_rate: 0.15
  non_concessional_cap_cents: ...
  division_293_threshold_cents: ...   # income + concessional above this attracts Div 293
  division_293_rate: 0.15
  carry_forward_balance_cap_cents: ...
  general_transfer_balance_cap_cents: ...
  co_contribution: { max_cents, lower_income_threshold_cents, higher_income_threshold_cents }
  preservation_age: 60
employment_termination:
  cap_cents: ...                      # ETP cap, indexed annually
  whole_of_income_cap_cents: ...      # not indexed; net of other taxable income
  below_preservation_age_rate: 0.30   # ATO's 32%, less the 2% Medicare levy
  at_preservation_age_rate: 0.15      # ATO's 17%, less the levy
  above_cap_rate: 0.45                # ATO's 47%, less the levy
  unused_leave_max_rate: 0.30         # ATO's 32%, less the levy
  genuine_redundancy: { base_limit_cents, per_year_of_service_cents }
car_expense:
  cents_per_km: 91          # ATO cents-per-kilometre car expense deduction rate
  max_claimable_km: 5000    # cap on business km claimable per car per year under this method
```

> **Values above are illustrative.** Each FY's real figures must be sourced from
> the ATO and stored as a config record. The engine reads config; it never assumes
> a rate. Ship one verified config per supported financial year.

## Shipped configs

- **FY2026** (`FY2026_CONFIG`, also in `configsByYear`) — a verified resident
  config for the closed 2025-26 financial year. Every figure, including the HELP
  indexation rate applied on 1 June 2026 (2.8%) and the 88c/km cents-per-km car
  expense rate (capped at 5,000km per car per year), is the ATO's final
  published or legislated value — none are provisional. It is the last year at
  the 16% lowest marginal rate, and carries the verified 2025-26 super figures
  (concessional cap $30,000, non-concessional cap $120,000, the $2.0M general
  transfer balance cap, the $250,000 Division 293 threshold, 15%
  contributions/Division 293 rate, the co-contribution income test, and
  preservation age 60), and the 2025-26 termination figures ($260,000 ETP cap, the
  $180,000 whole-of-income cap, and a $13,100 + $6,552-per-year genuine-redundancy
  tax-free amount). See `packages/tax/src/configs.ts`.
- **FY2027** (`FY2027_CONFIG`, also in `configsByYear`) — a verified resident
  config with real ATO figures for 2026-27, including the Budget top-up cut that
  drops the lowest marginal rate from 16% to 15% from 1 July 2026. Every figure
  carries its `ato.gov.au` source in a comment; figures the ATO has not yet
  published for 2026-27 (the Medicare levy low-income thresholds and the HELP
  indexation rate) reuse the latest known values and are flagged provisional. The
  91c/km cents-per-km car expense rate (an 89c indexed base plus a temporary 2c
  one-off uplift for 2026-27, capped at 5,000km per car per year) is final, not
  provisional — legislated ahead of the year via the Income Tax Assessment
  (Cents per Kilometre Deduction Rate for Car Expenses) Determination 2026. It
  also carries the verified 2026-27
  super figures (concessional cap $32,500, non-concessional cap $130,000, the
  $250,000 Division 293 threshold, 15% contributions/Division 293 rate, the
  co-contribution income test, and preservation age 60) and the 2026-27 termination
  figures ($270,000 ETP cap, the unindexed $180,000 whole-of-income cap, and a
  $13,598 + $6,801-per-year genuine-redundancy tax-free amount). See
  `packages/tax/src/configs.ts`.

## Testing

- Golden-file tests: known taxable incomes → expected liability per FY config.
- Cover bracket edges, LITO taper, Medicare low-income phase-in, surcharge tiers,
  and HELP thresholds.
- Effective-dated income: proration by inclusive calendar days, adjacent windows
  summing to the whole year, and non-overlapping windows contributing nil.
- One-off payments: each treatment's split, a redundancy whose tax-free amount
  covers the whole payment, nil and negative years of service, a payment above the
  ETP cap, a non-excluded payment whose whole-of-income headroom salary has already
  exhausted, both sides of the preservation-age split, an offset larger than the tax
  payable, two concessions stacked, and a payment landing outside the year.
- Non-resident cases as a follow-up.

## Presentation

The Tax tab shows a full per-member breakdown of how the total tax is built up,
annual and fortnightly. Each member card lists the components — income tax on the
brackets, less the Low Income Tax Offset, the Medicare levy, the Medicare levy
surcharge, the HELP/HECS repayment, and Division 293 tax — culminating in the
total tax, then the gross → less super → less tax → take-home framing. Income
tax, the Medicare levy, and the total always show; the optional components appear
only when they apply, with any nil components named beneath so a reader knows
they were considered. Because the surcharge is a household assessment, each
member's surcharge line already reflects the combined-income family tier. A
footnote reiterates that the estimate excludes capital gains tax.

The **withholding position** (`WithholdingPosition`) names where the year's actual
withholding sits against that liability: what the member's payslips withheld, of
the estimated tax, and the refund or bill the two imply — the refund direction in
the positive tone, the bill direction in the negative one. It is shared with the
EOFY tab so both name the position in the same words. The Tax tab shows it once a
payslip has recorded withholding; the EOFY tab shows it whenever the selected year
has any slips at all, and otherwise says none were recorded, because on a
filing-prep screen a year with no actuals must not read as a year that withheld
nothing.

Above the build-up tables, the breakdown opens with a **waterfall** of the same
figures (`taxWaterfallSteps` / `TaxWaterfall`): gross income at full width, then
deductions, the concessional-super diversion, and each tax component stepping down
as a floating bar, and take-home as the remaining bar. Income and take-home sit in
the positive tone, the concessional-super diversion in the salary-sacrifice brand,
deductions in the neutral buffer tone, and every tax component in the tax
(negative) family, all from the shared chart tokens. Income tax is drawn net of
the Low Income Tax Offset and each nil component is omitted, so the bars reconcile
exactly to the estimate's take-home.

A deduction lowers taxable income — and so the tax bars that follow — but is not
paid out of cash, so the waterfall steps it out of taxable income and then returns
it as a `Deductions kept` step before take-home; the down-and-up pair nets to nil
cash, leaving the smaller tax as the deduction's only effect. A caption states
this whenever a deduction shows. The gross and take-home endpoints are the card's
headline figures, so only the steps between them carry a printed amount.

Below the household card sits a **private hospital cover what-if**. It assesses
the family Medicare levy surcharge as if **neither** member held cover — the "what
if we drop cover" scenario — over the members' surcharge incomes: it reports the
combined income, the family tier rate it selects, and the resulting annual
household surcharge. Against an entered annual policy premium it reports whether
cover saves money (surcharge avoided exceeds the premium) or costs more than the
surcharge it avoids, and it shows "below the family MLS threshold" when combined
income is under the floor (so cover is not justified by the surcharge alone). Its
two inputs — a dependent-children count (raising the family floor per child after
the first) and the annual premium — are **ephemeral** local UI state, never
persisted.

## Salary-sacrifice what-if

Each member card carries an interactive what-if: enter an extra annual pre-tax
super contribution and see the trade-off, recomputed live on the pure engine
(`salarySacrificeWhatIf` in `@nest/tax`) over that member's own `TaxInput`.

- **Tax saved** = baseline total liability − the liability with the extra
  concessional contribution. It captures the marginal income tax, Medicare levy,
  and LITO effects, and is net of any extra Division 293 the contribution itself
  triggers.
- **Into super** = the extra sacrifice less the 15% contributions tax taken in
  the fund (`additional × (1 − contributionsTaxRate)`) — the beneficial amount
  actually saved, framed against the marginal tax saved above.
- **Take-home** = tax saved − the whole amount sacrificed. Signed and normally
  negative: sacrificing gives up more take-home now than it saves in tax, in
  exchange for the after-tax amount landing in super.
- **Division 293** — when the extra contribution pushes the member over the
  $250,000 threshold, a note shows the additional Division 293 tax; it is already
  included in the tax-saved figure.
- **Cap headroom** — a warning appears when the current concessional
  contributions plus the extra sacrifice exceed the member's concessional cap
  (the config cap plus their manual carry-forward, as shown on the Super tab),
  since the excess is taxed at the marginal rate rather than 15%.

The entered amount is **ephemeral** — held in local component state only, never
persisted to the database.

## Out of scope (initially)

- Capital gains tax, franking credits, negative gearing schedules, PAYG
  instalments, and business/GST accounting. Model as future extensions. The Tax
  tab notes the capital-gains exclusion so the estimate is not read as complete.
