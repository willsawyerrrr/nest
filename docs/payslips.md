# Payslips — expected vs actual income and tax

The plan-only app **projects** income (from inflows) and **estimates** tax (the
`@nest/tax` engine over each member's taxable inflows and `tax_profile`). Both are
forward models: they say what a member *should* earn and *should* be withheld.
A **payslip** carries the actuals — gross, PAYG withheld, super, deductions, net,
for one pay period, plus year-to-date running totals. Capturing payslips lets the
household reconcile actuals against the projection, per member, per pay period, and
surface variance: actual gross vs projected inflow, actual PAYG withheld vs the
estimate's implied withholding, actual super vs the modelled contribution.

Amounts are integer minor units (cents), as everywhere. Reconciliation is
per-member because AU tax is assessed per person and each member's income is
tagged to them.

## Goal

- Record, per member and per pay period, the actual figures from a payslip and
  correlate them with what the plan expected for that period.
- Surface variance the household can act on:
  - **Gross**: actual per-period gross vs the projected inflow for that member,
    prorated to the pay period. A persistent gap flags a stale inflow (a raise, a
    changed roster, a bonus).
  - **PAYG withheld**: actual withheld vs the estimate's implied per-period
    withholding. The tax estimate is annual-liability ÷ periods; comparing it to
    what the employer actually withholds is the leading indicator of a refund or a
    bill at year end.
  - **Super**: actual employer SG (and any salary sacrifice shown on the slip) vs
    the modelled super guarantee and concessional contributions, which feed the
    super balance accrual and the concessional-cap tracker.
- Feed **actual** PAYG withheld into the year-end position. The tax engine already
  accepts `paygWithheldCents` and returns `balanceCents` (positive = owing,
  negative = refund); the estimate path (`estimateHouseholdTax`) currently hardcodes
  it to nil. Summed actual withholding from payslips is the real input to that
  field, turning the estimate's abstract liability into a concrete refund/bill
  projection — the same outcome the Up ledger phase targets from the spend side.

## AU payslip fields

An Australian payslip is legally required to show, per pay period, the employer and
employee, the pay period dates and payment date, gross pay, net pay, and any
deductions and their purpose; and to show the super guarantee amount and the fund.
In practice a slip carries:

- **Pay period**: start and end dates (and often the payment date).
- **Gross** for the period, and **YTD gross**.
- **PAYG tax withheld** for the period, and **YTD withheld**.
- **Superannuation guarantee** for the period (employer SG), and often **YTD
  super**; **salary sacrifice** super shown separately when arranged.
- **Deductions** (pre- and post-tax) and **allowances**, itemised.
- **Net pay** for the period.
- **Leave balances** (not financially relevant here).

The must-have quartet for reconciliation is **gross, PAYG withheld, super, net**
for the pay period; YTD figures are valuable as a cross-check (they let a single
recent payslip anchor the whole year without entering every prior slip).

### Privacy

Payslips are sensitive personal documents (name, employer, income, sometimes tax
file references). If files are stored at all they go in a **private Supabase
Storage bucket**, never public, with access mediated by Storage RLS keyed on
household membership — the same isolation boundary as every table. The structured
figures live in a household-scoped table under the existing RLS. No file is
required for the feature to work: the numbers alone drive every variance.

## Capture options

**(a) Manual entry form.** A member types the key fields (pay period, gross, PAYG
withheld, super, net) into a form; nothing is uploaded. Simplest to build, no
Storage, no parsing, works offline in the PWA. The figures are exactly what
reconciliation needs. Downside: manual transcription each pay period.

**(b) File upload + manual key-field entry.** As (a), plus the member attaches the
PDF/image to a private Storage bucket for the record. The structured figures are
still typed; the file is an auditable attachment, not a data source. Adds Storage
RLS and an upload flow, but no parsing risk. Good middle ground once the household
wants the source document retained.

**(c) PDF/OCR parsing.** Upload the slip and extract fields automatically
(text-layer PDF parsing, or OCR for scans, likely in an edge function). Removes
transcription but is heavy and brittle: payslip layouts vary wildly by
employer/payroll provider, so extraction needs per-format handling or an
LLM/document-AI pass, and every parse still needs human confirmation before it
counts. High effort for a two-person household entering ~26 slips/year each.

**Recommendation: start with (a) manual entry**, then add **(b) optional file
attachment** once the structured flow is proven, and treat **(c) OCR** as a later
convenience that only ever pre-fills the same manual form (never writes figures
unconfirmed). Manual entry alone delivers the entire correlation value; upload and
OCR reduce effort but add no new analysis. This mirrors how the app already favours
smallest-useful-first (inflows before ingestion, manual goal balances before Up
savers).

## Data model sketch

A single household-scoped table, mirroring the conventions of `tax_profile` and
`super_contribution` (cents in `bigint`, RLS on household membership, composite FKs
on `(id, household_id)`):

- **payslip** — one actual pay event for a member.
  - `id`, `household_id`, `member_id` (not null — a payslip is always a person's).
  - `financial_year` (int, ending year) — derived from the pay period, for
    year-scoped rollups and to align with `tax_profile`.
  - `period_start` (date), `period_end` (date), `paid_on` (date, nullable).
  - `gross_cents`, `tax_withheld_cents`, `super_cents`, `net_cents` (all `bigint`).
  - `salary_sacrifice_cents` (nullable) — concessional sacrifice shown on the slip,
    for the concessional-cap cross-check; nullable because not every slip has one.
  - `ytd_gross_cents`, `ytd_tax_withheld_cents`, `ytd_super_cents` (nullable) — the
    slip's running totals, kept when entered as a cheaper anchor than summing rows.
  - `source_inflow_id` (nullable, composite FK `(id, household_id)` → `inflows`,
    `on delete set null`) — the projected inflow this slip reconciles against; see
    open questions on mapping.
  - `file_path` (nullable text) — Storage object path when a file is attached
    (option b); null under manual-only entry.
  - `note` (nullable), `created_at`, `updated_at`.
  - RLS: full CRUD for members of `household_id`, exactly as the planning tables.
  - Suggested index on `(household_id, member_id, period_end)` for the per-member
    timeline and YTD summing.

No new config: payslips are data, not versioned parameters. The Storage bucket
(option b onward) is private with membership-scoped policies.

## Correlation / UI sketch

Payslips are actuals about income and tax, so they surface where those are already
shown — a **member-scoped payslips list** plus **variance callouts on the Tax
tab**:

- **Entry & list**: a per-member payslips list (candidate home: the Household tab
  next to tax profiles and Up connection, or a dedicated section) showing each
  period's gross / withheld / super / net and its variance against the projection,
  most recent first, with an "Add payslip" form.
- **Variance computation** (pure, in `@nest/plan` or a sibling of `lib/tax`):
  - *Expected gross for the period* = the member's projected inflow annualised
    (via the existing `annualGrossCents` / schedule normalisation) then prorated to
    the payslip's period length. `gross_cents − expected` is the gross variance.
  - *Expected PAYG withheld for the period* = the member's annual estimated tax
    (from `estimateHouseholdTax`) ÷ periods per year, prorated to the period.
    `tax_withheld_cents − expected` is the withholding variance — the household's
    early read on whether the employer is over- or under-withholding versus the
    modelled liability.
  - *Expected super for the period* = modelled employer SG (`guarantee_rate ×`
    period gross) plus any period-prorated concessional contribution;
    `super_cents − expected` is the super variance.
- **Year-to-date refund/bill**: feed the summed actual `tax_withheld_cents` for the
  FY into the tax engine's `paygWithheldCents`, so the Tax tab's balance shows a
  concrete refund (negative) or amount owing (positive) from real withholding
  rather than the current nil assumption. YTD-withheld from the latest slip is an
  equivalent shortcut when per-slip entry is incomplete.

This sits naturally beside the Up ledger phase (which reconciles actual **tax
paid** from the spend/transfer side): payslips give the withholding actuals from
the income side, and the two converge on the same year-end position.

## Staging

Smallest-useful-first, each stage independently shippable:

1. **Manual entry + variance.** The `payslip` table (no file, no Storage), the
   per-member entry form and list, the pure variance math, and the Tax-tab
   withholding/refund readout from summed actual withheld. Delivers the full
   correlation value.
2. **File attachment.** Add the private Storage bucket, membership-scoped Storage
   RLS, `payslip.file_path`, and upload/download in the form and list. The record
   gains an auditable source document; the figures are still typed.
3. **OCR pre-fill (later).** Parse an uploaded slip to pre-populate the form for
   confirmation, never writing figures unconfirmed. Layout variance makes this the
   heaviest and least certain stage; defer until the manual flow is well used.

## Open questions

Deferred; resolved when the phase is picked up, not blocking.

- **OCR at all?** For two people entering ~26 slips/year each, is automatic
  extraction ever worth the layout-handling and confirmation overhead, or is
  manual entry (optionally with a stored file) the permanent answer?
- **Must-have fields.** Is the gross / withheld / super / net quartet enough, or
  are itemised deductions/allowances and leave wanted? Are YTD figures worth
  storing, or recomputed from rows?
- **Mapping a slip to a projected inflow.** A member may have several taxable
  inflows (base salary, a second job, irregular "other"). How is a payslip matched
  to the inflow it reconciles — an explicit `source_inflow_id` picker, an
  auto-match on member + amount + cadence, or member-level aggregate variance with
  no per-inflow mapping?
- **Multi-employer / irregular pay.** How to handle a member with two employers
  (two slip streams), a mid-year job change, or bonus/back-pay periods where a
  single slip won't match the steady projection.
- **Period vs YTD as the source of truth.** Prefer summing per-period rows, or
  trust the latest slip's YTD figures (which self-correct for missed entries)?
- **Interaction with Up ingestion.** Once the Up ledger lands, actual net pay
  appears as a deposit transaction. Should payslip `net_cents` be reconciled
  against that deposit, and does payslip withholding data merge with the ledger's
  actual-tax-paid tracking or stay a separate income-side view?
