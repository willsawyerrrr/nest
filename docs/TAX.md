# Australian income tax modelling

The tax engine is a pure function: given a member's financial-year figures and the
`TaxYearConfig` for that year, it returns a breakdown of liability and compares it
to tax already withheld. No hardcoded rates in code — all parameters live in a
versioned config per financial year, because AU rates and thresholds change yearly.

## Financial year

- AU FY runs 1 July – 30 June, labelled by the ending year (e.g. `FY2027` =
  1 Jul 2026 – 30 Jun 2027).
- Every computed value is scoped to a financial year.

## Inputs (per member, per FY)

- Assessable income: salary/wages, business, investment, other.
- Deductions (work-related, etc.).
- Residency status (resident vs non-resident brackets differ).
- Claims tax-free threshold (affects withholding expectations).
- Private hospital cover held (Medicare levy surcharge).
- HECS/HELP debt balance.
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
5. **Medicare levy surcharge** — income-tested; applies only without private
   hospital cover and above the surcharge threshold. Surcharge income adds the
   concessional super contributions back to taxable income.
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

Alongside the liability pipeline, `@budget/tax` exposes super helpers driven by
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

`projectSuperBalance` (in `@budget/plan`) is pure retirement math: it compounds
the current balance at the nominal return over the years to retirement and adds
the contributions as a growing annuity (each year's contribution grows at the
contribution-growth rate, invested at the nominal return), then deflates the
nominal total by inflation for a today's-dollars figure. All amounts are integer
cents; `years` is passed in for determinism.

> **Client-side assumptions.** The return, inflation, contribution-growth, and
> retirement-age assumptions, and each member's current age, are UI inputs held
> in localStorage — they are not persisted to the database. The retirement age
> defaults to the config's `preservation_age`.

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
  tiers: [ { income_over_cents, rate } ]
lito:
  max_offset_cents: ...
  taper_rules: [ ... ]
help_repayment:
  marginal_bands: [ { income_over_cents, rate } ]  # marginal, ordered by floor
  max_repayment_rate: 0.10                          # cap on whole repayment income
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

- **FY2027** (`FY2027_CONFIG`, also in `configsByYear`) — a verified resident
  config with real ATO figures for 2026-27, including the Budget top-up cut that
  drops the lowest marginal rate from 16% to 15% from 1 July 2026. Every figure
  carries its `ato.gov.au` source in a comment; figures the ATO has not yet
  published for 2026-27 (the Medicare levy low-income thresholds) reuse the
  2025-26 values and are flagged provisional. It also carries the verified 2026-27
  super figures (concessional cap $32,500, non-concessional cap $130,000, the
  $250,000 Division 293 threshold, 15% contributions/Division 293 rate, the
  co-contribution income test, and preservation age 60). See
  `packages/tax/src/configs.ts`.

## Testing

- Golden-file tests: known taxable incomes → expected liability per FY config.
- Cover bracket edges, LITO taper, Medicare low-income phase-in, surcharge tiers,
  and HELP thresholds.
- Non-resident and part-year cases as follow-ups.

## Presentation

The Tax tab shows a full per-member breakdown of how the total tax is built up,
annual and fortnightly. Each member card lists the components — income tax on the
brackets, less the Low Income Tax Offset, the Medicare levy, the Medicare levy
surcharge, the HELP/HECS repayment, and Division 293 tax — culminating in the
total tax, then the gross → less super → less tax → take-home framing. Income
tax, the Medicare levy, and the total always show; the optional components appear
only when they apply, with any nil components named beneath so a reader knows
they were considered. A footnote reiterates that the estimate excludes capital
gains tax.

## Out of scope (initially)

- Capital gains tax, franking credits, negative gearing schedules, PAYG
  instalments, and business/GST accounting. Model as future extensions. The Tax
  tab notes the capital-gains exclusion so the estimate is not read as complete.
