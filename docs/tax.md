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

## Inputs (per member, per FY)

- Assessable income: salary/wages, business, investment, other.
- Deductions (work-related, etc.).
- Residency status (resident vs non-resident brackets differ).
- Claims tax-free threshold (affects withholding expectations).
- Private hospital cover held (Medicare levy surcharge).
- HECS/HELP debt balance — a member's single standing balance from the
  `help_debt` table (edited on the HELP debt tab), not the tax profile.
- Concessional (pre-tax) super contributions — salary sacrifice and personal
  deductible.
- PAYG tax withheld to date (from payslips).

## Computation pipeline

1. **Taxable income** = assessable income − deductions − concessional super
   contributions (salary sacrifice and personal deductible both reduce it).
2. **Income tax** = apply marginal brackets from `TaxYearConfig`.
3. **Offsets** — subtract e.g. Low Income Tax Offset (LITO). Offsets reduce tax
   payable but not below zero.
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
9. **Balance** = total liability − PAYG withheld. Positive = amount owing;
   negative = estimated refund.

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
```

> **Values above are illustrative.** Each FY's real figures must be sourced from
> the ATO and stored as a config record. The engine reads config; it never assumes
> a rate. Ship one verified config per supported financial year.

## Shipped configs

- **FY2026** (`FY2026_CONFIG`, also in `configsByYear`) — a verified resident
  config for the closed 2025-26 financial year. Every figure, including the HELP
  indexation rate applied on 1 June 2026 (2.8%), is the ATO's final published or
  legislated value — none are provisional. It is the last year at the 16%
  lowest marginal rate, and carries the verified 2025-26 super figures
  (concessional cap $30,000, non-concessional cap $120,000, the $2.0M general
  transfer balance cap, the $250,000 Division 293 threshold, 15%
  contributions/Division 293 rate, the co-contribution income test, and
  preservation age 60). See `packages/tax/src/configs.ts`.
- **FY2027** (`FY2027_CONFIG`, also in `configsByYear`) — a verified resident
  config with real ATO figures for 2026-27, including the Budget top-up cut that
  drops the lowest marginal rate from 16% to 15% from 1 July 2026. Every figure
  carries its `ato.gov.au` source in a comment; figures the ATO has not yet
  published for 2026-27 (the Medicare levy low-income thresholds and the HELP
  indexation rate) reuse the latest known values and are flagged provisional. It
  also carries the verified 2026-27
  super figures (concessional cap $32,500, non-concessional cap $130,000, the
  $250,000 Division 293 threshold, 15% contributions/Division 293 rate, the
  co-contribution income test, and preservation age 60). See
  `packages/tax/src/configs.ts`.

## Testing

- Golden-file tests: known taxable incomes → expected liability per FY config.
- Cover bracket edges, LITO taper, Medicare low-income phase-in, surcharge tiers,
  and HELP thresholds.
- Effective-dated income: proration by inclusive calendar days, adjacent windows
  summing to the whole year, and non-overlapping windows contributing nil.
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
