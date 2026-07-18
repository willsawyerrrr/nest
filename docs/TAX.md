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
- PAYG tax withheld to date (from payslips).

## Computation pipeline

1. **Taxable income** = assessable income − deductions.
2. **Income tax** = apply marginal brackets from `TaxYearConfig`.
3. **Offsets** — subtract e.g. Low Income Tax Offset (LITO). Offsets reduce tax
   payable but not below zero.
4. **Medicare levy** — base rate (2%) with low-income reduction thresholds.
5. **Medicare levy surcharge** — income-tested; applies only without private
   hospital cover and above the surcharge threshold.
6. **HELP/HECS repayment** — income-tested compulsory repayment on repayment
   income, using the year's rate schedule.
7. **Total liability** = income tax − offsets + Medicare levy + surcharge +
   HELP repayment.
8. **Balance** = total liability − PAYG withheld. Positive = amount owing;
   negative = estimated refund.

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
  rates: [ { income_over_cents, rate } ]
super_guarantee_rate: 0.12
```

> **Values above are illustrative.** Each FY's real figures must be sourced from
> the ATO and stored as a config record. The engine reads config; it never assumes
> a rate. Ship one verified config per supported financial year.

## Testing

- Golden-file tests: known taxable incomes → expected liability per FY config.
- Cover bracket edges, LITO taper, Medicare low-income phase-in, surcharge tiers,
  and HELP thresholds.
- Non-resident and part-year cases as follow-ups.

## Out of scope (initially)

- Capital gains tax, franking credits, negative gearing schedules, PAYG
  instalments, and business/GST accounting. Model as future extensions.
