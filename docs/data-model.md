# Data model

Relational, stack-agnostic. Amounts are integer minor units (cents), stored in
`bigint` columns. Financial years are AU FYs (1 Jul – 30 Jun), labelled by their
ending year. Row-Level Security is the isolation boundary: every table is scoped
to a `household_id`, and a member sees or changes only rows in a household they
belong to. Five tables narrow that further: `accounts` limits which account
identities a member reads, `account_balance` and `transactions` add per-account
balance privacy (a co-member's balances and spend are not visible),
`gift_purchase` withholds the spend on gifts meant for the caller, and
`push_subscription` is own-member-only (see the security model in
[`architecture.md`](architecture.md#security)). Cross-household references are
additionally blocked by composite foreign keys on `(id, household_id)`.

Every table carrying an `updated_at` maintains it through a `BEFORE UPDATE`
`set_updated_at` trigger; `deduction_receipt` is the one table without the column
and so without the trigger.

> The planning tables (inflows, budget lines, temporary items, savings goals)
> are described from the user's perspective in
> [`budget-and-savings.md`](budget-and-savings.md); tax inputs in
> [`tax.md`](tax.md). The `supabase/migrations/` files are authoritative.

## Household & members

- **households** — the shared container for a household's members and data.
  - `id`, `name`, `timezone` (default `Australia/Sydney`), `created_at`,
    `updated_at`.
  - `invite_code` (nullable, unique) and `invite_code_expires_at` (nullable) —
    a single-use, opt-in code a partner redeems to join. Both are null unless a
    member has generated one; it expires after 7 days and is consumed on join.
  - `pay_account_id` (nullable) — the single spending account the household's pay
    lands in, the source for the Pay splits tab. A composite FK `(pay_account_id, id)
    → accounts (id, household_id)` keeps it within the household, and
    `on delete set null (pay_account_id)` names the column so deleting the account
    clears the designation alone and leaves the household row standing — a
    columnless set-null on this FK would also target the `households.id` half of
    the reference. Written only through the `set_household_pay_account` RPC (see
    RPCs), not a broad households update.
- **members** — a person in a household, linked to an auth user.
  - `id`, `household_id`, `user_id` (→ `auth.users`), `name`, `email`
    (nullable), `date_of_birth` (date, nullable), `up_connected_at` (nullable),
    `created_at`, `updated_at`.
  - `date_of_birth` is optional and read for one thing: the member's age at a
    one-off payment's date, tested against the financial year's preservation age
    to set the concessional rate an employment termination payment is taxed at
    (see [`tax.md`](tax.md)). Unset reads as below preservation age — the higher
    rate — so a missing date understates the payment, never the tax.
  - Unique on `(household_id, user_id)`. All members can manage everything in
    the household; member attribution elsewhere is a tax/reporting tag, not a
    permission.
  - `up_connected_at` records when the member's Up token was last stored (null =
    not connected). It is a non-sensitive status flag readable under the members
    RLS; the token itself lives only in Vault and is never exposed here. The
    token is stored/read/cleared solely by SECURITY DEFINER RPCs granted to
    `service_role` (`store_up_token` / `up_token_for_member` / `clear_up_token`).
    It is service-role-write-only: `authenticated` holds column-scoped UPDATE on
    `name`/`email`/`date_of_birth` only, so a client cannot forge its Up
    connection status.
  - `service_role` holds the table grants the Up edge functions read under:
    `select` on `members` and `select`/`insert`/`update` on `accounts`, for member
    lookup and for resolving a synced transaction's account. The sync's writes go
    through SECURITY DEFINER RPCs (see RPCs) rather than these grants.

## Inflows

- **inflows** — projected money in, split by taxability, and either recurring on
  a cadence or landing once on a date.
  - `id`, `household_id`, `member_id` (nullable), `name`,
    `type` (`salary` | `wage` | `other` | `reimbursement` | `hobby` | `gift`),
    `taxable` (default true), `attracts_super` (default true), `schedule`
    (nullable), `interval_count` (nullable), `pay_schedule` (nullable),
    `pay_interval_count` (nullable), `arrives_every_pay_period` (default true),
    `amount_cents` (nullable),
    `hourly_rate_cents` (nullable), `hours_per_period` (nullable), `starts_on`
    (date, nullable), `ends_on` (date, nullable), `pay_anchor_date` (date,
    nullable), `paid_on` (date, nullable), `one_off_tax_treatment` (nullable),
    `years_of_service` (int, nullable), `created_at`, `updated_at`.
  - **Recurring or one-off.** A CHECK (`inflows_recurrence`) requires exactly one
    of `schedule` and `paid_on`: a recurring inflow states the cadence its money
    comes on, a one-off states the single date it lands on. Severance, a bonus, or
    a gift from a relative arrives once, and a cadence cannot say that — read as
    `annual`, the money is smeared into the fortnightly buffer, routed through a
    pay split, and measured against a payslip period, so a payment that lands once
    reads as a household permanently ahead and then permanently behind.
  - A one-off carries none of the machinery a cadence needs, held by a CHECK
    (`inflows_one_off_shape`): where `paid_on` is set, `interval_count`,
    `pay_schedule`, `pay_interval_count`, `starts_on`, `ends_on`, and
    `pay_anchor_date` are all null, `arrives_every_pay_period` is true, and
    `type` is not `wage` — an amount paid once has no hours to price.
    `amount_cents` is the whole payment, since the day it lands on is the only
    period it covers. A recurring inflow is unconstrained by the rule.
  - A **taxable** one-off states how it is taxed. `one_off_tax_treatment` is the
    `one_off_tax_treatment` enum — `ordinary` (a bonus, commission, or back-pay:
    assessable in full at marginal rates), `genuine_redundancy`,
    `employment_termination` (a golden handshake or payment in lieu of notice),
    `unused_leave` (annual or long service leave paid out on a redundancy) — and a
    CHECK (`inflows_one_off_tax_treatment`) requires it exactly when `paid_on` is
    set and the inflow is taxable, so a recurring inflow and a non-taxable one-off
    (a gift) carry none. `years_of_service` prices a genuine redundancy's tax-free
    amount (a base limit plus a per-year amount for each completed year); a CHECK
    (`inflows_years_of_service`) requires it present and ≥ 0 under that treatment
    and null under every other. What each treatment concedes, and how the estimate
    models it, is canonical in [`tax.md`](tax.md).
  - `starts_on` / `ends_on` bound when the rate applies; both null means the
    whole year. A CHECK (`inflows_effective_dates`) requires
    `ends_on >= starts_on` where both are set. The tax estimate prorates each
    inflow's annual gross by its active share of the financial year in inclusive
    calendar days, so a mid-year pay rise is modelled as the old rate ending and
    a new dated inflow starting — see
    [`tax.md`](tax.md#effective-dated-income). A one-off sets neither: its
    `paid_on` is both its first day and its last, and it counts in full in the
    financial year that date falls in or not at all.
  - `pay_anchor_date` is a separate fact from `starts_on`: one date the
    household confirms the inflow's money actually lands on, which need not be
    the effective-from date — an inflow effective from 1 July might not
    actually pay until the 11th. It touches calendar placement only: the
    [calendar feed](calendar-feed.md) steps a recurring inflow's cadence
    forward and backward from it, in preference to `starts_on`, in preference
    to a fixed fallback epoch. Annualisation, the tax estimate, and the
    fortnightly budget never read it. Nullable, with no backfill; null on a
    one-off, which has no cadence to anchor.
  - `taxable` inflows feed the per-member tax estimate and require `member_id`;
    non-taxable inflows (reimbursement, hobby income, gift, or other) add to
    available cash and may omit it. For non-taxable inflows `type` is a reporting
    label only — taxability, not type, decides whether an inflow is taxed.
  - `attracts_super` marks the inflow as ordinary time earnings, the base the
    employer super guarantee accrues on. It is false for an allowance paid on
    top of ordinary hours — an on-call or standby payment — which is taxed in
    full but earns no super. It drives the super side only: a non-OTE inflow is
    left out of the annual SG and percent-of-salary bases, and out of a
    payslip's expected employer super via the `payslip_line` rows drawing on it
    (see [`payslips.md`](payslips.md)).
  - `schedule` is the shared `frequency` enum: `weekly`, `fortnightly`,
    `monthly`, `quarterly`, `biannual`, `annual`, `every_n_weeks`,
    `every_n_months`. For `every_n_weeks` and `every_n_months`, `interval_count`
    holds N (≥ 1) — the unit (weeks or months) read from the schedule; it is null
    for every fixed schedule and on a one-off, which has no schedule to
    interpolate — a null `schedule` makes the CHECK's `IN` test null, so it falls
    to the branch requiring the count absent, exactly as `pay_interval_count`
    reads a null `pay_schedule`. Periods-per-year and fortnightly/annual
    normalisation are canonical in
    [`budget-and-savings.md`](budget-and-savings.md#schedules--normalization).
  - **How the amount is expressed and how often it arrives are separate facts.**
    `schedule` is the period `amount_cents` (or `hours_per_period`) covers — the
    frequency the amount is **expressed** in, and the only one annualising reads.
    A salary defined as an annual number is `annual` here however often it is
    paid, held losslessly as the figure the household was quoted.
    `pay_schedule` (with `pay_interval_count`) is the cadence the money
    **arrives** on; null means it arrives on the frequency the amount is
    expressed in, which is every row's default and needs no backfill. So a
    $130,000 salary paid fortnightly is `schedule = 'annual'`,
    `amount_cents = 13_000_000`, `pay_schedule = 'fortnightly'`.
    `pay_interval_count` keeps lockstep with `pay_schedule` exactly as
    `interval_count` does with `schedule` — a CHECK (`inflows_pay_interval_count`)
    requires it present and ≥ 1 for the two interpolated cadences and null
    otherwise, including when `pay_schedule` itself is null.
  - The pay cadence sets **one** thing: the pay cycle a payslip's period is
    measured against — how long one whole turn runs, how many turns a year holds,
    and so whether a period is a whole turn or part of one (see
    [`payslips.md`](payslips.md#how-an-expected-figure-is-scaled)). Everything
    that annualises an amount keeps reading `schedule`, the pay cadence changing
    nothing about it: the FY tax estimate, the effective-date proration of that
    annual figure, the budget's fortnightly/annual normalisation, and the pay
    splits drawn from it. A per-payment figure is **derived, never stored** —
    annual ÷ the pay cadence's periods per year, rounded to the nearest cent — so
    a year of payments may sit a few cents either side of the annual figure, which
    the inflow form names when it does.
  - `arrives_every_pay_period` says whether the money lands on **every** turn of
    that cadence. False for pay arriving in only some of them — on-call paid on the
    fortnightly payrun, but only for the fortnights a shift was worked — which a
    cadence alone cannot express, since any cadence claims the money arrives every
    turn. Like the pay cadence it touches one thing: a payslip period holds no
    expectation for such an inflow, so its earnings-line group reports a null
    expectation and variance on the `occasional` basis, the slip's gross expectation
    goes null rather than counting that group as nil, and the inflow is never the
    slip's cadence anchor. Annualisation and every projection drawn from it are
    unaffected — the flag is about **when** the money lands, not whether it is
    expected — and the household reads such an inflow across the financial year
    instead; see [`payslips.md`](payslips.md#pay-that-lands-in-only-some-periods).
    Like `attracts_super` it is a taxable-inflow concern, only a taxable inflow being
    reconciled against a payslip, and is stored true for a non-taxable one. A
    one-off holds it true and it says nothing there, there being no cadence for it
    to say anything about; a one-off is kept out of a period's expectations by its
    `paid_on` alone.
  - Amount shape by `type`: `wage` carries `hourly_rate_cents` ×
    `hours_per_period` (and null `amount_cents`); every other type carries a
    flat `amount_cents` per period. Either shape may carry a pay cadence: 38
    hours a week at $45 paid fortnightly is `schedule = 'weekly'`,
    `hours_per_period = 38`, `pay_schedule = 'fortnightly'`. A one-off takes the
    flat shape, its `type` never being `wage`.

## Tax inputs

- **tax_profile** — per member, per financial year; drives the tax engine.
  - `id`, `household_id`, `member_id`, `financial_year` (int, ending year),
    `residency` (`resident` | `foreign_resident`),
    `has_private_hospital_cover` (Medicare levy surcharge), `created_at`,
    `updated_at`.
  - Unique on `(member_id, financial_year)`.
- **help_debt** — per member; one standing HELP/HECS balance, not
  financial-year-scoped.
  - `id`, `household_id`, `member_id`, `balance_cents` (bigint, `>= 0`),
    `created_at`, `updated_at`.
  - Unique on `(member_id)`; composite FK on `(member_id, household_id)` →
    `members`. Feeds the tax engine's marginal HELP repayment and the Net worth
    tab as a liability. Edited on the HELP debt tab.
- **deduction** — per member, per financial year; many rows per member (a
  collection). A deductible expense whose amount reduces that member's taxable
  income. Edited on the member's Tax deductions tab.
  - `id`, `household_id`, `member_id`, `description`, `amount_cents` (bigint,
    `>= 0`), `deduction_date` (date), `financial_year` (int, ending year),
    `basis` (`deduction_basis` enum: `amount` default, or `distance`),
    `distance_km` (`numeric(8,2)`, nullable), `full_amount_cents` (bigint,
    `>= 0`), `work_use_percent` (`numeric(5,2)`, default 100), `created_at`,
    `updated_at`.
  - `financial_year` is the year the expense is claimed in and is stored rather
    than derived from `deduction_date`, with no constraint tying the two: an
    expense incurred near a year boundary is claimed in whichever year the
    household lodges it. It is the FY scope every read filters on, so the Tax and
    EOFY tabs for a year see only that year's rows.
  - `amount_cents` is always the figure downstream readers use; `basis` says how
    it was arrived at. On the `distance` basis (a work-related car expense
    claimed under the ATO's cents-per-kilometre method), the form computes
    `amount_cents` from `distance_km` at `financial_year`'s published cents-per-km
    rate (`@nest/tax`'s `carExpense` config, via `carExpenseDeductionCents`) and
    saves that computed figure — not the distance — as the historical record, the
    same snapshot-at-write-time pattern `payslip_line.attracts_super` follows so a
    later change to the ATO rate never retroactively moves a deduction already
    claimed. The `deduction_basis_attribution` check constraint holds each basis
    to its own column (`distance_km` non-null and `>= 0` only when
    `basis = 'distance'`), mirroring `payslip_line_kind_attribution`; the
    database does not itself derive `amount_cents` from `distance_km`, since the
    rate is versioned in `@nest/tax`, not stored in Postgres.
  - On the `amount` basis, `amount_cents` may be less than the expense's full
    cost: `full_amount_cents` records what it cost, `work_use_percent` the share
    claimed (100 by default). `deduction_work_use_apportioned` requires
    `amount_cents = round(full_amount_cents * work_use_percent / 100)`, enforced
    in the database rather than trusted from the client — `workUseAmountCents`
    (`apps/pwa/src/lib/money.ts`) computes the identical rounding client-side, so
    the form's shown claimable figure never disagrees with what the constraint
    will accept. `deduction_work_use_range` bounds `work_use_percent` to `(0,
    100]` and `full_amount_cents` to non-negative;
    `deduction_work_use_basis` pins `work_use_percent` at 100 on the `distance`
    basis, since its kilometres are work-related already and a percentage on top
    would discount the claim twice. `full_amount_cents` has no plain column
    default — "whatever `amount_cents` says" is not a constant, `DEFAULT` cannot
    read another column of the same row — so a BEFORE INSERT trigger,
    `snapshot_deduction_full_amount`, fills it from `amount_cents` when a write
    leaves it null, the same shape `snapshot_payslip_line_attracts_super` fills
    `payslip_line.attracts_super` with. A write naming no work-use figures at
    all is therefore claimed in full at 100%, through the RPC below or a direct
    insert alike.
  - `member_id` is the tax attribution: a deduction reduces the taxable income of
    exactly one member, so it must be set (not null) even though the money is
    pooled. Composite FK `(member_id, household_id)` → `members`
    `on delete cascade`, so a removed member's claims go with them. Unique on
    `(id, household_id)` — the key `deduction_receipt` composite-FKs against.
    Indexed on `(household_id)` and `(member_id)`.
  - **In the estimate.** The tax adapter sums each member's rows into that
    member's `TaxInput.deductionsCents`, which `taxableIncome` subtracts —
    alongside concessional super — from assessable income, so their estimated tax
    falls and their take-home rises. It surfaces as a Deductions line in the Tax
    tab's per-member income build-up and, in the waterfall, as a down-and-up pair
    (out of taxable income, returned as *Deductions kept*) because a deduction
    costs no cash: the smaller tax is its only effect on take-home. See
    [`tax.md`](tax.md#computation-pipeline). The same figures feed each member's
    EOFY card.
  - RLS is **household-wide CRUD** — the same boundary as `tax_profile`,
    `help_debt`, `super_contribution`, and `payslip`. `member_id` is a
    tax/reporting attribution, not a privacy boundary: the two returns are lodged
    against one pooled pot, so each member maintains their co-member's claims.
  - Adding a deduction is written, alongside every receipt already uploaded for
    it, through `create_deduction_with_receipts` (below) rather than a direct
    insert — the client mints the id before the row exists, so a receipt
    picked first can be filed under it. Editing an existing row is a direct
    update, as any other field write is.
  - `group_id` files the deduction as one payment of an expense claimed more
    than once, or is null for a standalone claim. Composite FK
    `(group_id, household_id, member_id, financial_year)` → `deduction_group`,
    so a payment cannot sit in a group belonging to another member or another
    year, `on delete set null (group_id)` — the column list matters, a bare
    `set null` nulling every referencing column, three of which are not null.
    Indexed on `(group_id)`.
- **deduction_group** — a named set of one member's deductions for one financial
  year: the many payments of one expense claimed more than once — a subscription
  paid monthly, a trip's several receipts — totalled for display.
  - `id`, `household_id`, `member_id`, `name`, `financial_year`, `created_at`,
    `updated_at`. Composite FK `(member_id, household_id)` → `members`
    `on delete cascade`. Unique on `(id, household_id, member_id, financial_year)`
    — the key a deduction composite-FKs against, which is what holds a payment to
    its group's member and year in the same reference.
  - **It holds no amount.** The total shown against a group is summed from its
    payments at read time, because each payment is a `deduction` the tax estimate
    already counts; a stored total would be the only figure in the app able to
    disagree with what is actually claimed. Nothing in the estimate, the EOFY tab,
    or the Summary reads this table at all — grouping is presentational.
  - **One financial year.** An expense whose payments span 30 June is one group
    per year. A group's total is meant to BE the figure claimed for its year, so a
    group spanning years would total money from two returns, and the Deductions
    tab — which shows one year — could only ever display part of it.
  - Deleting a group ungroups its payments rather than deleting them: each stays
    an ordinary deduction, still claimable on its own.
  - Membership is editable after the fact. The deduction form's Group picker
    lists the member's groups for the year plus an explicit None, so a standalone
    deduction can be filed under a group and a payment moved between groups or
    taken out. It is withheld only when the answer is already settled — adding a
    payment from a group's own row. The write is a plain `deduction` update, so
    nothing passes through `create_deduction_with_receipts`.
  - RLS is **household-wide CRUD**, as for `deduction` itself.
- **deduction_receipt** — a stored receipt file backing a deduction; many rows
  per deduction.
  - `id`, `deduction_id`, `household_id`, `storage_path`, `file_name`,
    `created_at`. No `updated_at`: `file_name` is the only field an edit ever
    touches, and nothing reads when a label was last changed.
  - Composite FK `(deduction_id, household_id)` → `deduction (id, household_id)`
    `on delete cascade` — deleting a deduction takes its receipt rows with it.
    Indexed on `(deduction_id)` (the list read) and `(household_id)`.
  - `storage_path` is the object key in the private `receipts` bucket (see
    **Storage buckets**), laid out `<household_id>/<deduction_id>/<file>`. The
    leading household segment is load-bearing: the `storage.objects` policy
    matches it against `household_ids_for_current_user()`, so the file's access
    boundary is the row's rather than something separately administered.
    `file_name` is the label the receipt is shown under, since the key itself is
    generated. It is chosen as the file is attached — the file's own name, one
    the member types, or `Receipt` where neither is given — and retyped in place
    from the deductions list. A label alone: naming and renaming never touch
    `storage_path` or the stored object.
  - RLS is household-wide CRUD on `household_id`, matching `deduction`. The
    boundary is drawn at the household, not the claiming member, for the same
    reason: a receipt is filing evidence for a jointly planned pair of returns,
    so either member may attach one and either may read it back.
- **equity_grant** — per member; many rows per member (a collection). A startup
  equity grant with a cliff and vesting schedule whose vested value counts toward
  net worth as an asset.
  - `id`, `household_id`, `member_id`, `label`, `instrument_type`
    (`option` | `share`), `quantity` (bigint whole units, `>= 0`), `grant_date`,
    `cliff_months` (int, default 12), `vesting_period_months` (int, default 48,
    `> 0`), `vesting_frequency` (`monthly` | `quarterly` | `annual`),
    `strike_price_cents` (bigint, nullable, options only), `price_per_share_cents`
    (bigint, `>= 0`, user-maintained current fair value), `price_as_of`
    (nullable), `created_at`, `updated_at`.
  - `instrument_type` and `vesting_frequency` are `text` with a CHECK on the
    allowed values rather than enums — they are grant paperwork, not a shape
    other tables share.
  - Composite FK on `(member_id, household_id)` → `members`. Vesting and
    valuation are computed client-side by `@nest/plan` (`vestedQuantity`,
    `grantValueCents`); the vested value seeds the Net worth tab as an asset.
    Edited on the Equity tab.
- **payslip** — per member; many rows per member (a collection). One pay event's
  actual figures, reconciled through its lines against the projected inflows and
  the tax estimate. See [`payslips.md`](payslips.md).
  - `id`, `household_id`, `member_id`, `financial_year` (int, ending year),
    `period_start` (date), `period_end` (date), `paid_on` (date, nullable),
    `gross_cents`, `tax_withheld_cents`, `super_cents`, `net_cents` (bigint,
    all `>= 0`), `salary_sacrifice_cents` (nullable, `>= 0`), `ytd_gross_cents`,
    `ytd_tax_withheld_cents`, `ytd_super_cents` (nullable, `>= 0`),
    `file_path` (nullable), `note` (nullable), `created_at`, `updated_at`.
  - The quartet and the YTD figures are the slip's **printed totals**, and the
    slip carries no inflow of its own: which projections its pay came from, and
    which parts of the liability its tax paid, are its `payslip_line` rows'
    business.
  - `tax_withheld_cents` is the slip's **tax total** — PAYG income tax plus any
    STSL study-loan component, not the PAYG line alone — and
    `ytd_tax_withheld_cents` the year-to-date total on the same basis. The tax
    estimate's liability includes the compulsory HELP repayment the STSL pays, so
    only the total nets against it, whether or not the components are itemised as
    tax lines; see
    [`payslips.md`](payslips.md#tax-withheld-is-the-slips-tax-total).
  - `financial_year` is the year the pay **landed** in, derived from `paid_on` and
    falling back to `period_end` where the slip states no payment date — salary and
    wages are assessed in the year they are paid, so a fortnight worked to 28 June
    and paid 1 July is filed under the later year.
    `payslip_financial_year(paid_on, period_end)` is that derivation in SQL, and
    the `payslip_financial_year` check constraint requires the column to equal it,
    so no client can file a slip under the year its work fell in. The column stays
    plain and writable rather than generated, so `upsert_payslip_with_lines` still
    inserts it and the loader still filters on it.
  - `period_end >= period_start` (`payslip_period`). The money columns are
    non-negative rather than positive: `tax_withheld_cents` is legitimately zero
    below the tax-free threshold, and `super_cents` is zero on a slip that omits
    it. YTD figures hold the running totals as printed on the slip, so one recent
    slip anchors the year without entering every prior one; they are null when not
    entered and are not cross-checked against the per-period columns in a
    constraint (a mid-year employer change or an out-of-order entry breaks that
    relation legitimately).
  - `financial_year` is derived from the pay period's last day on entry and stored,
    and it is the FY scope every read filters on, so the Payslips tab and the EOFY
    tab for a year see only that year's slips.
  - **In the estimate.** Each member's `tax_withheld_cents` for the year are summed
    into their `TaxInput.paygWithheldCents`, which the engine subtracts from their
    total liability as `balanceCents` — the year's refund or amount owing. It changes
    no tax figure, only the position. Both the Tax tab (current year) and the EOFY
    tab (its selected year) render that position, and the slip count is what tells a
    year that withheld nothing from a year with no slips entered.
  - Composite FK on `(member_id, household_id)` → `members` `on delete cascade`,
    so a removed member's slips go with them. That is the slip's only reference:
    retiring an inflow leaves every stored figure alone, clearing only the lines'
    own links to it.
  - `file_path` is the object key of an attached slip in the private `payslips`
    bucket (see **Storage buckets**); null under figures-only entry.
  - RLS is **household-wide CRUD** — the same boundary as `tax_profile`,
    `help_debt`, `super_contribution`, and `deduction`. `member_id` is a
    tax/reporting attribution, not a privacy boundary: the household's money is
    fully pooled, so each member manages their co-member's slips. A payslip is a
    sensitive document and the household, not the individual member, is the trust
    boundary that protects it. Deliberate, not an oversight.
- **payslip_line** — per payslip; many rows per slip. One line as the slip prints
  it: an **earnings** line drawing on a projected inflow, or a **tax** line paying
  a component of the estimated liability. See [`payslips.md`](payslips.md).
  - `id`, `household_id`, `payslip_id`, `kind` (`payslip_line_kind`:
    `earning` | `tax`, default `earning`), `source_inflow_id` (nullable),
    `tax_component` (`payslip_tax_component`: `payg` | `stsl`, nullable), `label`,
    `amount_cents` (bigint), `attracts_super` (nullable), `created_at`,
    `updated_at`.
  - `kind` decides what the line is measured against, and the
    `payslip_line_kind_attribution` check constraint holds each kind to the
    columns that mean anything for it: an `earning` names an inflow (or none) and
    carries `attracts_super`, with `tax_component` null; a `tax` line names a
    `tax_component` with `source_inflow_id` and `attracts_super` both null. The
    constraint's `case` ends in `else true`, so a further kind added to the enum
    states its own pairing rather than being rejected by a rule written before it
    existed.
  - `amount_cents` is **signed**, unlike the slip's own totals: an earnings line
    may be a negative adjustment reversing an overpayment. The lines need not sum
    to the slip's `gross_cents` or `tax_withheld_cents` — each remainder is
    unallocated and surfaced as such rather than silently absorbed.
  - Composite FK on `(payslip_id, household_id)` → `payslip (id, household_id)`
    `on delete cascade`, so a line goes with the slip it hangs off (and with the
    member, through the slip). Composite FK on
    `(source_inflow_id, household_id)` → `inflows (id, household_id)`
    `on delete set null (source_inflow_id)`, so retiring the inflow keeps the
    line's amount. **Many lines may draw on the same inflow** — ordinary hours
    and annual leave both come off the salary — so there is deliberately no
    uniqueness on `(payslip_id, source_inflow_id)`.
  - Earnings variance is measured per inflow: the lines drawing on one inflow are
    summed and held against that inflow's expectation for the period, and the
    lines recorded as earning no super come off the base the expected employer
    super guarantee is charged on. A group drawing on an inflow that arrives in only
    some pay periods is not measured against the period at all. The **largest
    measurable earnings group's** inflow is the pay cycle the slip's own withholding
    and concessional-super expectations are divided by — the slip carries no cadence
    of its own, and an occasional inflow is never that anchor.
  - Tax variance is measured per component: `stsl` against the compulsory HELP
    repayment inside the liability and `payg` against the rest of it.
  - `attracts_super` is the ordinary-time-earnings record, **snapshotted from the
    inflow** by a `before insert` trigger
    (`snapshot_payslip_line_attracts_super`) when the writer of an earnings line
    does not state it; a line naming no inflow is ordinary time earnings, and a
    tax line is left untouched so one carrying a decision is refused by the
    pairing constraint. The column has no default, so an unstated value reaches
    the trigger as null. Snapshotting is what makes a payslip a historical record:
    `source_inflow_id` is `on delete set null`, so re-deriving the decision would
    silently put a retired allowance back into every past slip's super base.
  - RLS is **household-wide CRUD**, exactly the parent slip's boundary. Writes go
    through `upsert_payslip_with_lines` (below) rather than direct inserts, so a
    slip and its lines move together.
- Versioned AU tax parameters (rates, thresholds) live in config, not a table —
  see [`tax.md`](tax.md).

## Superannuation

Per-member super feeds two things: the tax estimate (concessional contributions
reduce taxable income; Division 293 for high earners) and, via the balance, a
net-worth view. Versioned AU super parameters (SG rate, caps, thresholds) live in
config alongside the tax parameters, not a table.

- **super_profile** — per member, per financial year.
  - `id`, `household_id`, `member_id`, `financial_year` (int, ending year),
    `fund_name` (nullable), `sg_rate_override` (nullable — overrides the config
    SG rate), `linked_account_id` (nullable), `carry_forward_cap_cents`
    (default 0), `balance_as_of` (date, nullable), `created_at`, `updated_at`.
  - Unique on `(member_id, financial_year)`.
  - `linked_account_id` optionally points at one of the household's accounts whose
    `balance_cents` is the member's super balance — the same balance-source
    pattern `savings_goal` uses; a composite foreign key on `(id, household_id)`
    keeps it in the household and `on delete set null` clears it if the account is
    removed.
  - `carry_forward_cap_cents` is a manually entered unused concessional cap
    carried from up to 5 prior years (eligible when total super balance <
    $500,000); it raises the effective cap for the year.
  - `balance_as_of` is the date the linked account's `balance_cents` was last
    confirmed (a "true-up"). It turns the stored balance into a **dated baseline**:
    the **effective current balance** = `balance_cents` + the member's modelled net
    annual contributions accrued from `balance_as_of` to today (contributions
    only — no investment growth applied to the live figure), so the figure stays
    current under payday super without any external integration. Saving a balance
    is a true-up: it rewrites `balance_cents` and resets `balance_as_of` to today.
    Null treats the stored balance as current (no accrual). The Super tab shows the
    effective balance with a baseline + accrued breakdown, and the Net worth tab
    sums super accounts at their effective balance. Net annual contribution reuses
    the tax engine's `netAnnualSuperContributionByMember`: `(concessional +
    employer SG) × (1 − contributions tax) + non-concessional + co-contribution`.
- **super_contribution** — a recurring contribution for a member and year.
  - `id`, `household_id`, `member_id`, `financial_year`,
    `kind` (`salary_sacrifice` | `personal_deductible` |
    `personal_non_concessional` | `spouse`),
    `mode` (`amount` | `percent`), `amount_cents` (nullable),
    `percent_bp` (nullable — basis points of gross salary),
    `frequency` (the shared enum), `interval_count` (nullable),
    `fhss_eligible` (default false), `contributor_member_id` (nullable),
    `created_at`, `updated_at`.
  - A check enforces exactly one of `amount_cents` / `percent_bp` per `mode`, and
    `interval_count` is set only for `every_n_weeks`/`every_n_months` (as on
    inflows). The
    concessional kinds (`salary_sacrifice`, `personal_deductible`) reduce taxable
    income; `spouse` may carry `contributor_member_id` (the paying member, for the
    spouse-contribution tax offset). `fhss_eligible` tags contributions counting
    toward the First Home Super Saver scheme.

## Planning & goals

Budgeting is plan-only and fortnightly. There is no period-versioned budget and
no per-member scoping; each line stands alone under the household.

- **budget_line** — a planned recurring allocation within one fixed group.
  - `id`, `household_id`, `line_group`
    (`needs` | `wants` | `discretionary` | `savings` | `investments`), `name`,
    `amount_cents`, `frequency` (the shared enum above), `interval_count`
    (nullable — non-null iff `frequency` is `every_n_weeks`/`every_n_months`, as
    on inflows),
    `goal_id` (nullable), `breakdown_id` (nullable), `is_gift_line` (bool),
    `gift_recipient_member_id` (nullable), `destination_account_id`
    (nullable), `created_at`, `updated_at`.
  - `goal_id` links to a savings goal; only `savings`/`investments` lines may
    set it. Many lines may fund one goal.
  - `breakdown_id` marks a **derived line** whose amount is rolled up from a
    breakdown's items rather than typed by hand — see [Breakdowns](#breakdowns).
    Null is an ordinary manual line. Composite FK `(breakdown_id, household_id)` →
    `breakdown` `on delete cascade`.
  - `is_gift_line` marks a **gift-derived line** rolled up directly from the gift
    tables by the reconcile pass — see [Gift tables](#gift-tables). A gift line has
    `is_gift_line` true and `breakdown_id` null (there is no gift breakdown).
    `gift_recipient_member_id` partitions the gift lines: it names the member whose
    gifts a "Gifts for &lt;member&gt;" line funds (one per member with gift
    budgets), and is null on the single external ("others") line and on every
    non-gift line. Composite FK `(gift_recipient_member_id, household_id)` →
    `members` `on delete cascade`.
  - `destination_account_id` routes the line to the Up account that funds it for
    the Pay splits tab — see [Pay splits](#pay-splits). Nullable composite FK
    `(destination_account_id, household_id)` → `accounts`, `on delete set null`.
    A CHECK (`budget_line_destination_group`) bars it on `savings`/`investments`
    lines, which route via their goal's linked saver instead.
- **savings_goal** — a persistent savings target.
  - `id`, `household_id`, `name`, `target_amount_cents`, `target_date`
    (nullable), `current_balance_cents` (default 0), `linked_account_id`
    (nullable), `annual_interest_bps` (nullable), `queue_position` (nullable
    integer), `planned_contribution_cents` (nullable, `>= 0`), `created_at`,
    `updated_at`.
  - Funded by the budget lines that reference it via `goal_id`. A goal with no
    linked line is **queued**: `queue_position` orders the household's queued
    goals (blank sorts last; a client-managed sort key rewritten `0..n` on
    drag-reorder, not unique-enforced, ignored once the goal has a linked line),
    and `planned_contribution_cents` optionally caps the fortnightly amount it
    draws from the capacity freed as active goals complete — null draws the whole
    available pool and the remainder cascades to the next queued goal. The
    projection is pure, in `@nest/plan`'s `projectGoalQueue`; queued goals derive
    no budget line and no pay split.
  - `linked_account_id` optionally points at one of the household's accounts (in
    practice a synced Up saver); when set, the goal's current balance is read
    from that account's `balance_cents` rather than `current_balance_cents`. A
    composite foreign key on `(id, household_id)` keeps the link within the
    household, and `on delete set null` clears it if the account is removed.
    `current_balance_cents` is the manually entered fallback used when no account
    is linked.
- **temporary_item** — a date-driven fortnightly outflow that runs until it
  expires.
  - `id`, `household_id`, `name`, `contribution_cents` (fortnightly),
    `target_date` (not null), `created_at`, `updated_at`.
- **wishlist_item** — an aspirational purchase kept apart from the budget.
  - `id`, `household_id`, `name`, `amount_cents` (`> 0`), `member_id`
    (nullable), `note` (nullable), `created_at`, `updated_at`.
  - `member_id` is a single-column FK to `members (id)`, `on delete set null` —
    a display and reporting tag naming whose wish it is, not a privacy boundary
    and not a per-person budget.
  - Feeds no projection, no pay split, and no tax figure. The Wishlist tab
    promotes an item to a `savings_goal` or a Discretionary `budget_line`,
    prefilling the target form; the wishlist row stays until deleted.
  - Household-wide RLS (`household_ids_for_current_user()`), matching
    `savings_goal` / `budget_line` / `temporary_item`.

## Breakdowns

A budget line's amount is normally typed by hand. It can instead be **derived**:
rolled up from a **breakdown** — a user-created itemised list that owns the line —
so the line and its detail share one source of truth and never drift. Breakdowns
are data, not a fixed enum: the household creates arbitrary breakdowns and assigns
each to a budget group. See [`breakdowns.md`](breakdowns.md) for the full design.

- **breakdown** — a household-created itemised list that owns one derived line.
  - `id`, `household_id`, `name` (the rolled-up line's name), `line_group`
    (`budget_group` enum — the group the rolled-up line belongs to), `kind`
    (`breakdown_kind` enum: `generic`-only, default `generic`), `created_at`,
    `updated_at`. Unique on `(id, household_id)`.
  - Every breakdown row is `generic` and rolls up its `breakdown_item` rows. Gift
    budget lines roll up directly from the gift tables via
    `budget_line.is_gift_line` (see [Gift tables](#gift-tables)).
- **breakdown_item** — a line item of a breakdown (every breakdown is `generic`).
  - `id`, `household_id`, `breakdown_id`, `name`, `amount_cents`, `frequency`
    (the shared enum), `interval_count` (nullable — the same CHECK as
    `budget_line`), `created_at`, `updated_at`. Composite FK
    `(breakdown_id, household_id)` → `breakdown` `on delete cascade`.

The derived line's amount is the summed-annualised roll-up of the breakdown's
items and is read-only in every budget surface. The line exists only while the
breakdown has items (a routed line — one carrying a `destination_account_id` —
survives an empty breakdown so its pay-split routing is not lost). A non-null
`breakdown_id` marks a line as derived and owned by that breakdown, its amount
rolled up from the breakdown's items; a null `breakdown_id` is an ordinary manual
line — or, when `is_gift_line` is true, a gift-derived line rolled up from the gift
tables (see below).

The database is the sole authority for these lines: `reconcile_derived_lines`
(see [Reconcile](#reconcile)) creates, updates, and removes them from triggers on
every roll-up source, so no client maintains them. Their lifecycle, amount, and
one-line-per-breakdown mapping are trigger-enforced rather than constraint-enforced
— see [`breakdowns.md`](breakdowns.md).

### Gift tables

The bespoke gift planner: plan a spend per **recipient × occasion**, then record
the actual purchases against it. The reconcile pass rolls these tables up directly
into the gift budget lines (`budget_line.is_gift_line`, partitioned by
`gift_recipient_member_id`) with no breakdown row. All four
tables are household-scoped under the ledger's RLS, with composite foreign keys on
`(id, household_id)` that keep every reference inside the household. A gift's
agreed budget is shared, but its purchases are private from the recipient when the
recipient is a household member (see **Private gifts** below).

- **gift_recipient** — a named person the household budgets gifts for.
  - `id`, `household_id`, `name`, `member_id` (nullable), `created_at`,
    `updated_at`. Unique on `(id, household_id)`.
  - `member_id`, when set, links the recipient to a household member: the
    recipient *is* that member, and their gift purchases are hidden from them.
    Null is an external person, fully shared. Composite foreign key
    `(member_id, household_id)` → `members` `on delete cascade`, and a partial
    unique index on `(household_id, member_id) where member_id is not null` keeps
    it one recipient per member.
  - **Every household member is a permanent recipient.** An AFTER INSERT trigger
    on `members` (`add_member_gift_recipient`, `SECURITY DEFINER` so it bypasses
    the insert RLS on whichever path added the member) auto-creates the member's
    recipient, and the `on delete cascade` FK removes it with the member — a
    member recipient exists iff the member does. A `BEFORE UPDATE` guard
    (`prevent_member_recipient_edit`) rejects edits to any recipient with a
    non-null `member_id`, so a member recipient is never renamed or relinked;
    DELETE is left unguarded so the cascade can fire. Adding a recipient by hand
    is therefore for external people only.
- **gift_occasion** — a named gifting occasion with an optional date.
  - `id`, `household_id`, `name`, `occasion_date` (nullable), `created_at`,
    `updated_at`. Unique on `(id, household_id)`. Recurrence/year-scoping is out
    of scope for v1 — a named occasion plus an optional date.
- **gift_budget** — one planned amount per recipient × occasion.
  - `id`, `household_id`, `recipient_id`, `occasion_id`,
    `budgeted_amount_cents` (default 0, ≥ 0), `event_date` (nullable),
    `created_at`, `updated_at`.
  - `event_date` overrides the occasion's shared `occasion_date` for this
    pairing: a birthday falls on a different date for each recipient, so the
    specific date belongs on the pairing. The effective date is
    `event_date ?? occasion.occasion_date`.
  - Composite foreign keys `(recipient_id, household_id)` → `gift_recipient` and
    `(occasion_id, household_id)` → `gift_occasion`, both `on delete cascade`.
    Unique on `(recipient_id, occasion_id)` and on `(id, household_id)`.
- **gift_discretionary_budget** — the household's single ad hoc gift buffer: a
  planned amount not linked to any recipient's or occasion's `gift_budget`.
  - `id`, `household_id` (`unique`, so exactly one row per household),
    `budgeted_amount_cents` (default 0, ≥ 0), `created_at`, `updated_at`. Unique
    on `(id, household_id)`.
  - Created lazily on first edit — a household with no ad hoc spend planned has
    no row at all, read client-side as a zero budget.
  - Its amount folds into the external ("Gifts (others)") derived line rather
    than minting a line of its own (see **Reconcile** below): a household-wide
    buffer partitioned no differently from an external recipient's budgets.
- **gift_purchase** — an actual purchase assigned to a `gift_budget`, or an ad
  hoc one assigned to the household's `gift_discretionary_budget` instead.
  - `id`, `household_id`, `gift_budget_id` (nullable),
    `gift_discretionary_budget_id` (nullable), `recipient_id` (nullable),
    `amount_cents` (≥ 0), `description` (default `''`), `purchased_on`,
    `transaction_id` (nullable), `created_at`, `updated_at`.
  - `gift_budget_id`/`gift_discretionary_budget_id` are each nullable, and
    exactly one is set (`gift_purchase_budget_xor_discretionary`): a purchase is
    budget-linked or ad hoc, never both, never neither. Composite foreign keys
    `(gift_budget_id, household_id)` → `gift_budget` `on delete cascade` and
    `(gift_discretionary_budget_id, household_id)` → `gift_discretionary_budget`
    `on delete cascade`.
  - `recipient_id` optionally tags an ad hoc purchase with a `gift_recipient`,
    for record-keeping only — it carries no budget of its own, so it may be set
    only alongside `gift_discretionary_budget_id`
    (`gift_purchase_recipient_requires_discretionary`); a budget-linked
    purchase's recipient is already implied by its `gift_budget.recipient_id`.
    Composite foreign key `(recipient_id, household_id)` → `gift_recipient`
    `on delete set null` on that column alone, so removing the tagged recipient
    leaves the purchase standing, untagged.
  - `transaction_id` is the synced Up transaction the purchase was linked from,
    null for a hand-entered one. Composite foreign key
    `(transaction_id, household_id)` → `transactions`, `on delete set null` on
    that column alone, so losing the transaction leaves the purchase standing as
    a hand-entered one. A partial unique index on `transaction_id` keeps it one
    purchase per transaction. `up-sync` holds a linked purchase's
    `amount_cents` to its transaction's magnitude — a hold settles at whatever the
    merchant finally charges — while its description and date stay as the
    household set them.
- **gift_transaction_dismissal** — a synced transaction the household marked "not
  a gift", keeping it out of the candidate inbox (Up files charity donations in
  the same category as gifts).
  - `id`, `household_id`, `transaction_id`, `created_at`, `updated_at`.
    `unique (transaction_id)`, and a composite foreign key
    `(transaction_id, household_id)` → `transactions` `on delete cascade`.
  - The blanket "household members manage" policy: the row names a transaction
    and nothing else, and the Gifts screen resolves it only by joining
    `transactions`, where the balance-visible gate applies — so a dismissal
    naming a co-member's private spending resolves, for the other partner, to no
    transaction at all. A dismissal cascades away with its transaction, which is
    right: once Up no longer reports the transaction in the gift category, it is
    not a candidate to dismiss.

**Private gifts.** `gift_recipient`, `gift_occasion`, `gift_budget`, and
`gift_discretionary_budget` carry the shared blanket "household members manage"
policy — the agreed budget is set together and a recipient may see their own
budgeted amount, and it still feeds the derived Gifts budget line and pay splits
unchanged. `gift_purchase` instead has per-command policies that branch on which
kind of purchase a row is, since `gift_budget_id` is nullable and
`null not in (...)` would otherwise evaluate to unknown — silently hiding and
blocking every ad hoc purchase:

- A budget-linked purchase (`gift_budget_id` not null) keeps the original check:
  `gift_budget_id not in (select hidden_gift_budget_ids_for_current_member())`.
  `hidden_gift_budget_ids_for_current_member()` is a `SECURITY DEFINER` helper
  returning the gift-budget ids whose recipient is linked to one of the caller's
  members (mirroring `visible_balance_account_ids`), so a member never reads and
  cannot log a purchase for their own surprise, while the buyer — any other
  member — sees and manages it normally.
- An ad hoc purchase (`gift_budget_id` null) is instead gated on its own
  optional `recipient_id` tag:
  `recipient_id is null or recipient_id not in (select hidden_gift_recipient_ids_for_current_member())`.
  `hidden_gift_recipient_ids_for_current_member()` mirrors the budget helper,
  returning the `gift_recipient` ids linked to one of the caller's members, so a
  member never reads and cannot log an ad hoc purchase tagged to their own
  recipient; an untagged purchase, or one tagged to the other member or an
  external recipient, is visible to both.

`SELECT`/`UPDATE`/`DELETE`/`INSERT` all carry the same branch (plus household
membership).

The card spend behind such a purchase is withheld too, so the claim cannot leak
through the ledger: the `transactions` `SELECT`, `UPDATE`, and `DELETE` policies
also require `id not in (select hidden_gift_transaction_ids_for_current_member())`
— the transactions named by purchases against the caller's own gifts. Whichever
account paid for it, a transaction the household has claimed as a gift for you is
not yours to read, so the candidate inbox cannot offer you your own present. Spend
claimed for an external recipient, and unclaimed spend, stay under the
balance-visible rule alone.

## Ledger

`accounts` is populated by the `up-sync` edge function from every Up account the
member can see — savers, spending accounts, and home loans alike (see the Up
integration in [`architecture.md`](architecture.md)); a savings goal links to one
via `savings_goal.linked_account_id`. `transactions` holds one slice of the
ledger: the gift-category Up transactions `up-sync` polls, which the Gifts screen
links purchases from. Every other Up category, manual entry, and spending-plan
reconciliation are a later phase, so `categories` — the household's own taxonomy —
stays unpopulated and a synced row's `category_id` is null.

- **accounts** — an identity-only bank or savings account; its balance lives in
  `account_balance`.
  - `id`, `household_id`, `owner_member_id` (nullable = joint), `name`,
    `type` (`transaction` | `savings` | `credit` | `offset` | `other` |
    `home_loan` — a home loan synced from Up; net worth reads its balance as a
    liability and the routing surface excludes it),
    `source` (`up` | `manual`), `external_id`,
    `currency` (default `AUD`), `exclude_from_net_worth` (default `false` — a
    shared, household-wide flag that drops the account from net-worth totals
    only, leaving retirement projection and budgeting untouched),
    `deleted_from_source_at` (nullable — set by `up-sync` when the source stops
    reporting a still-referenced account, cleared if it reappears; the PWA shows
    such an account as "deleted in Up"), `created_at`, `updated_at`.
  - `unique (source, external_id)` is the sync's dedupe key — global rather than
    household-scoped, since an Up account id is globally unique and a joint
    account seen by both partners must collapse to the one shared row.
    `unique (id, household_id)` lets the balance, goal, split, and routing
    references composite-FK an account without leaving the household.
  - **Identity privacy.** SELECT spans both account surfaces' rules: a member
    reads the identity of shared/joint accounts (`owner_member_id` null), their
    own accounts, any member's `transaction` account (so a co-member's spending
    can be named for routing), and any household super account (retirement stays
    joint). A co-member's plain saver stays invisible. Inserts, updates, and
    deletes are limited to shared or self-owned rows. No balance column: a balance
    write goes through `account_balance`, gated separately.
- **account_balance** — one balance per account, keyed 1:1 by `account_id`
  (`on delete cascade`, plus a composite FK `(account_id, household_id)` →
  `accounts`).
  - `account_id`, `household_id`, `balance_cents` (bigint), `updated_at`.
  - Split out of `accounts` so the identity surface needs no SECURITY DEFINER
    view. `up-sync` keeps a saver's balance current; a linked savings goal reads
    its balance from here.
  - **Balance privacy.** RLS returns a balance only for the balance-visible set —
    shared/joint accounts, the caller's own, and household super accounts (those
    linked from a `super_profile`), identical to the `transactions` gate
    (`visible_balance_account_ids()`); a co-member's spending and savers are
    excluded, so their balance is never returned. `authenticated` holds
    `select`/`insert`/`update`/`delete`; `service_role` holds
    `select`/`insert`/`update` for the sync.
- **account_directory** (view) — an identity-only surface over `accounts` for
  budgeting and splits: `id`, `household_id`, `owner_member_id`, `name`, `type`,
  `source`, `deleted_from_source_at` — never a balance. It carries shared accounts, the caller's own
  accounts, and any member's `transaction` account, so a co-member's spending
  account can be named as a budget-line funding destination and summed into the
  pay split without exposing its balance; a co-member's savers and super accounts
  are absent, as is every `home_loan` account (a liability, never a routing
  destination — a joint one would otherwise pass the ownership rule). A plain
  invoker view (`security_invoker = on`): it reads under the caller's own
  `accounts` RLS, then narrows to the directory rule.
- **accounts_with_balance** (view) — account identity joined to its balance for
  the balance-visible set (shared, own, and household super accounts), exposing
  the account columns plus `balance_cents`. A plain invoker view
  (`security_invoker = on`): the `accounts` and `account_balance` policies both
  apply, and the inner join yields a row only where identity and balance are both
  visible, so a co-member's spending or saver balance never appears. Net worth,
  goal balances, and super balances read from here.
- **transactions** — a single ledger entry.
  - `id`, `household_id`, `account_id`, `member_id` (nullable, attribution),
    `category_id` (nullable), `external_category` (nullable), `posted_at`,
    `amount_cents` (signed, negative = outflow), `description`,
    `kind` (`income` | `expense` | `transfer`),
    `status` (`pending` | `settled`), `source` (`up` | `manual`),
    `external_id` (dedupe key), `notes`, `created_at`, `updated_at`.
    `unique (source, external_id)` is the sync's dedupe key, and
    `unique (id, household_id)` lets a gift purchase or dismissal reference a
    transaction without leaving the household.
  - `external_category` is the category the *source* assigned — Up's
    `gifts-and-charity` for every row the gift poll lands — as distinct from
    `category_id`, which points at the household's own (unpopulated) taxonomy.
  - RLS gates each transaction to the balance-visible account set, so a member
    reads and writes transactions only on accounts whose balance they can see: a
    co-member's spending account is outside that set, so their gift-category spend
    never reaches the other partner's inbox, while a joint (2Up) account's spend
    reaches both. `SELECT`, `UPDATE`, and `DELETE` add the gift gate on top,
    excluding `hidden_gift_transaction_ids_for_current_member()` so a transaction
    claimed as a gift for the caller is withheld from them (see **Private gifts**).
    `INSERT` carries the account gate alone — a row being created cannot yet be
    claimed by any purchase.
  - Attribution mirrors the account: `member_id` is the resolved account's
    `owner_member_id`, null for a joint account. A synced transaction whose
    account is absent from `accounts` is skipped rather than landed.
- **categories** — hierarchical income/expense taxonomy.
  - `id`, `household_id`, `parent_id` (nullable, self-referential), `name`,
    `kind` (`income` | `expense`), `is_archived`, `created_at`, `updated_at`.

## Pay splits

Each budget line routes to the Up account that funds it via
`budget_line.destination_account_id`; the Pay splits tab sums those into a recommended
fortnightly pay split per account. Up exposes no pay-split API, so the household
sets the split in Up by hand and confirms the amount app-side. See
[`pay-splits.md`](pay-splits.md).

- **pay_split** — the fortnightly split the household has confirmed as set in Up
  for one account.
  - `id`, `household_id`, `account_id`, `confirmed_fortnightly_cents`,
    `confirmed_at`, `created_at`, `updated_at`.
  - `unique (household_id, account_id)` keeps it one-per-account; composite FK
    `(account_id, household_id)` → `accounts` `on delete cascade`. The Pay splits tab
    compares the recommendation against this to surface drift and offer a Confirm.

## Push notifications

- **push_subscription** — one Web Push subscription per opted-in device, owned by
  the member whose device it is.
  - `id`, `household_id`, `member_id`, `endpoint`, `p256dh`, `auth`,
    `created_at`, `updated_at`.
  - `endpoint` is the push service URL that identifies the device, `unique` so a
    re-subscribing device upserts `on conflict (endpoint)` instead of
    accumulating rows. `p256dh` (the subscription's P-256 public key) and `auth`
    (its auth secret) are the base64url values the aes128gcm payload encryption
    derives from. Composite FK `(member_id, household_id)` → `members`
    `on delete cascade`; indexed on `(household_id)` and `(member_id, household_id)`.
  - **RLS is own-member-only, not household-wide** — the sole exception to the
    shared-planning-data rule. An endpoint is a bearer capability to push to
    someone's phone, so all four commands are gated on
    `member_id in (select current_member_ids())` on top of household membership:
    a member cannot read, delete, or reassign a co-member's device row, and an
    upsert onto a co-member's endpoint fails rather than taking the device over.
  - `authenticated` holds all four grants; `service_role` holds only `select` (to
    send) and `delete` (to prune the endpoints a push service reports gone). It
    never inserts one — only a device's own browser mints a subscription.

- **notification_preference** — one member's on/off choice for one notification
  trigger, the same own-member boundary as `push_subscription`.
  - `id`, `household_id`, `member_id`, `trigger`, `enabled` (`not null default
    true`), `created_at`, `updated_at`. `unique (member_id, trigger)`; an absent
    row means the trigger is on, so a member who never opens the settings
    receives every trigger. Composite FK `(member_id, household_id)` → `members`
    `on delete cascade`.
  - `trigger` is the `notification_trigger` enum: `buffer_negative`,
    `goal_eta_slipped`, `temporary_item_expiring`, `fy_boundary`. Each is a
    per-trigger toggle in the Household screen's Notifications card
    (`useNotificationPreferences`), shown once a device is subscribed.
  - RLS is own-member-only (four per-command policies gated on
    `current_member_ids()`), like `push_subscription`. `authenticated` holds all
    four grants; `service_role` holds `select` alone — the evaluator reads
    preferences and never writes one.

- **notification_log** — the evaluator's dedupe ledger: one row per push
  `notify-eval` sent.
  - `id`, `household_id`, `member_id`, `trigger`, `dedupe_key`, `sent_at`
    (`default now()`). `unique (member_id, trigger, dedupe_key)` is the dedupe —
    a key already present (within the trigger's re-notify window) is not re-sent.
    Composite FK `(member_id, household_id)` → `members` `on delete cascade`;
    indexed on `(household_id)` and `(member_id, trigger, sent_at)`.
  - `dedupe_key` per trigger: the financial year for `buffer_negative`
    (re-notified after 14 days) and `fy_boundary`, `<goal_id>:<target_date>` for
    `goal_eta_slipped`, the item id for `temporary_item_expiring`.
  - RLS is enabled with **no `authenticated` policy and no `authenticated`
    grant** — a member sees that a notification arrived, never the ledger.
    `service_role` holds `select` and `insert` only.

## Storage buckets

Files live in **private** Supabase Storage buckets, never public. Every object key
starts with the owning `<household_id>` as its first path segment, and a
`for all to authenticated` policy on `storage.objects` matches that segment against
`household_ids_for_current_user()` — the same membership boundary as the tables,
applied to the files.

- **receipts** — deduction receipts, keyed
  `<household_id>/<deduction_id>/<file>`; the row is `deduction_receipt`.
- **payslips** — attached payslip documents, keyed
  `<household_id>/<payslip_id>/<file>`; the key is `payslip.file_path`.

## RPCs

Membership and invites run through `SECURITY DEFINER` functions so a
not-yet-member can act past RLS in the narrow ways allowed:

- `create_household(name, member_name)` — create a household and enrol the
  caller as its first member.
- `join_household(code, member_name)` — enrol the caller via an active,
  unexpired invite code, then consume the code.
- `create_invite_code()` — generate a single-use code (7-day expiry) for the
  caller's household.
- `revoke_invite_code()` — clear the caller's household's invite code.
- `set_household_pay_account(account_id)` — set (or, with null, clear) the
  caller's household `pay_account_id`. Rejects anything that is not a
  `type = 'transaction'` account in the caller's household, so households writes
  stay controlled without opening a broad column update.
- `household_ids_for_current_user()` — the households the caller belongs to;
  the basis for every RLS policy.
- `current_member_ids()`, `household_super_account_ids()`, and
  `visible_balance_account_ids()` — the SECURITY DEFINER helpers behind per-account
  balance privacy: the caller's member ids, the household's super-linked account
  ids, and the account ids whose balance the caller may see (shared, own, or
  super) — the last gating the `account_balance` and `transactions` policies
  without recursing through the `accounts` policies.
- `hidden_gift_budget_ids_for_current_member()` — the SECURITY DEFINER helper
  behind private gifts: the gift-budget ids whose recipient is linked to one of
  the caller's members, gating the `gift_purchase` policies so a member never sees
  or logs a purchase for a gift meant for them.
- `hidden_gift_transaction_ids_for_current_member()` — its ledger counterpart: the
  transactions named by purchases against those same gift budgets, gating the
  `transactions` read, update, and delete policies so the card spend behind a gift
  meant for the caller is withheld from them. SECURITY DEFINER precisely because
  the caller cannot read those `gift_purchase` rows themselves.

One RPC is a plain **invoker** function, elevating nothing: it exists for the
transaction, not for the privileges.

- `upsert_payslip_with_lines(payslip jsonb, lines jsonb) returns uuid` — writes
  one payslip and replaces its whole `payslip_line` set — earnings and tax lines
  alike, a line payload omitting `kind` writing the earning an unqualified line is
  — in a single call, and so a single transaction. A slip and its lines are one thing the member saves, and
  saving them as two calls leaves the pair half-written whenever the second
  fails — worst of all on an edit, where the clearing delete lands and the insert
  does not, taking every line with it. Keyed on the id the client mints, so
  pressing Save again after a failure rewrites that same slip rather than adding
  a second one to inflate the year-to-date totals. Running as the caller is the
  point: the household policies on both tables gate every statement in it exactly
  as they gate a direct write, and `household_id` is not updatable on conflict,
  so a slip cannot be moved or hijacked across households.
- `create_deduction_with_receipts(deduction jsonb, receipts jsonb) returns uuid`
  — writes one deduction and replaces its whole `deduction_receipt` set in a
  single call. Only the add-deduction flow uses it: the form lets a member pick
  receipt files before the deduction exists, uploading each straight to Storage
  (which has no foreign key), so the id the form mints has to reach both tables
  in one transaction — `deduction_receipt.deduction_id` is a real,
  non-deferrable foreign key, so a receipt row cannot be inserted first. Keyed
  on that same id, so a retried save rewrites the deduction and replaces its
  receipt set rather than duplicating either. It carries the deduction's `basis`
  and, on the distance basis, its `distance_km`; the group it is filed under
  (`group_id`); and its work-use apportioning (`full_amount_cents`,
  `work_use_percent`): the add form writes every new deduction through this
  function, so a column it does not name is one the add path cannot set, and a
  work-travel deduction, a grouped payment, or a part-claimed expense would
  otherwise save wrong or fail the apportioning constraint outright. A payload
  naming no basis writes `amount`; naming no work-use percentage writes 100 (the
  column's own default), and naming no `full_amount_cents` leaves it null for
  `snapshot_deduction_full_amount` to fill from `amount_cents` — the same
  BEFORE INSERT trigger a direct insert relies on. Running as the caller: the
  household policies on both tables gate every statement exactly as a direct
  write would, and `household_id` is not updatable on conflict. Editing an
  existing deduction never calls this RPC — its receipts are attached one at a
  time through the ordinary `deduction_receipt` insert path, since the
  deduction id is already real.

The Up token and VAPID RPCs are also `SECURITY DEFINER`, but granted to
`service_role` alone (not `authenticated`) — they are the only path to secrets
that live in Vault:

- `store_up_token(member_id, token)` — upsert the token into Vault under
  `up_token:<member_id>` and stamp `members.up_connected_at`.
- `up_token_for_member(member_id)` — return the decrypted token (server-side
  sync only).
- `clear_up_token(member_id)` — delete the Vault secret and null
  `up_connected_at`.
- `upsert_up_accounts(rows jsonb)` — the `up-sync` dual-write: for each row,
  upserts the account identity into `accounts` (on `(source, external_id)`) and
  its balance into `account_balance` (on `account_id`) in one transaction, so
  identity and balance never diverge.
- `sync_up_gift_transactions(household_id, account_ids, since, rows jsonb)` —
  settles one member's gift-category window in a single transaction: upserts
  every row Up returned (on `(source, external_id)`), holds each linked
  `gift_purchase` to its transaction's amount, then prunes the gift-category rows
  the pass did not return — over exactly `account_ids` and from `since` forward,
  keeping any transaction a purchase links to. An empty `rows` clears the window,
  the case where the last gift candidate was recategorised away in the Up app.
- `reconcile_up_accounts(household_id, owner_member_id, present_external_ids text[])`
  — the `up-sync` account reconcile: over one member's individually-owned
  `source = 'up'` accounts, clears `deleted_from_source_at` on the ones in the
  list, deletes the absent ones nothing references (`account_balance` cascades),
  and stamps `deleted_from_source_at` on the absent ones a `savings_goal`,
  `budget_line`, `households.pay_account_id`, or `super_profile` still holds. An
  empty list is a valid "this member has no Up accounts" result. Joint accounts
  and other households' rows are out of scope.
- `reconcile_joint_up_accounts(household_id, present_external_ids text[])` — the
  joint twin of the above: over one household's joint (`owner_member_id is
  null`) `source = 'up'` accounts, clears `deleted_from_source_at` on the ones
  in the list, deletes the absent ones nothing references (`account_balance`
  cascades), and stamps `deleted_from_source_at` on the absent ones a
  `savings_goal`, `budget_line`, `households.pay_account_id`, or `super_profile`
  still holds. `up-sync` calls it once per household, only when every connected
  member synced with a readable token, passing the union of the ids those
  tokens returned. An empty list is a valid "no member reported any Up account"
  result. Individually-owned accounts and other households' rows are out of
  scope.
- `vapid_keys()` — the Web Push VAPID credential set (base64url public key,
  base64url private key, `mailto:` subject) as one row, nulls when unset. One
  function rather than three: the sender needs all of it in the same breath (the
  private key to sign the VAPID JWT, the public key for its `k=` parameter, the
  subject for its `sub` claim), so this is one round trip and one grant. It has no
  store counterpart — the operator sets and rotates the secrets by hand
  ([`operations.md`](operations.md#web-push-vapid-keypair-setup)).
- `anthropic_api_key()` — the Anthropic API key from Vault, for the
  `payslip-extract` edge function. Read-only, the same shape as
  `up_token_for_member`: there is no store counterpart because no client ever
  supplies this key, so the operator writes it by hand
  ([`operations.md`](operations.md#anthropic_api_key-setup)). Null when unset,
  which degrades extraction to manual entry rather than failing.

Because these RPCs run as their owner, `service_role` needs no grant on the
tables they write; the surgical grant stance is in
[`operations.md`](operations.md#service_role-grants).

Every function in the schema — RPC, helper, and trigger alike, `SECURITY DEFINER`
or invoker — is declared `set search_path = ''`, so each body schema-qualifies
everything it names and nothing it resolves can be shadowed by a relation, type,
or operator planted in a schema earlier on the caller's path. The RLS suite
asserts the invariant over the whole of `pg_proc`, so a function that omits the
setting fails CI.

## Reconcile

The derived budget lines — the breakdown roll-ups and the gift lines — are
maintained entirely in the database, by `SECURITY DEFINER` functions that are
granted to **no role at all**. They are unreachable over PostgREST and run only as
their owner from the triggers below, so the derived lines cannot be forged or left
stale by a client.

- `reconcile_derived_lines(household_id)` — the whole pass for one household:
  computes the derived lines the current sources imply and applies the creates,
  updates, and deletes needed to match, no-opping when they already do. It reads
  each roll-up through `reconcile_generic_total` (a breakdown's annualised items),
  `reconcile_gift_total` (a recipient's gift budgets, plus — for the external,
  null-member partition only — the household's `gift_discretionary_budget`
  amount), and `reconcile_buyer_account` (the *other* member's
  `type = 'transaction'` account, which funds a "Gifts for &lt;member&gt;" line),
  with `reconcile_annual_cents` normalising an amount + frequency + interval to
  annual cents and `budget_line_derived_fields` resolving one line's group,
  name, amount, and destination. The external partition's line is created or
  kept whenever it has budgets, is routed, **or** the discretionary buffer's
  amount is positive — folding the buffer straight into "Gifts (others)" rather
  than minting a line of its own.
- Seven `AFTER` triggers named `reconcile_derived_lines` call it whenever a
  source changes, each narrowed to the columns that can move a roll-up:
  `breakdown_item` (insert/delete/update of `amount_cents`, `frequency`,
  `interval_count`, `breakdown_id`), `breakdown` (update of `name`,
  `line_group`), `gift_budget` (insert/delete/update of
  `budgeted_amount_cents`, `recipient_id`), `gift_recipient` (delete/update of
  `member_id`), `members` (insert/delete/update of `name`), `accounts`
  (insert/delete/update of `owner_member_id`, `type`, `name` — the three columns
  that decide which account funds a gift line), and `gift_discretionary_budget`
  (insert/delete/update of `budgeted_amount_cents`).
- `budget_line_normalize_derived` — a `BEFORE INSERT OR UPDATE` trigger on
  `budget_line` that canonicalises any derived row on write, so a hand-issued
  write cannot leave a derived line inconsistent with its source.

Two more triggers sit outside the reconcile: `add_gift_recipient` on `members`
(`AFTER INSERT`, auto-creating the member's permanent gift recipient) and
`prevent_member_recipient_edit` on `gift_recipient` (`BEFORE UPDATE`) — both
described under [Gift tables](#gift-tables).

## Derived / computed (not stored)

- Planned spend per group and the live remaining buffer: projected after-tax
  income less budget-line allocations and temporary-item contributions,
  normalised to a common period from each line's `frequency`.
- Savings-goal progress and required contribution rate: `current_balance_cents`
  against `target_amount_cents` and `target_date`, projected from the summed
  contributions of the budget lines funding it.
- Tax estimate: the tax engine over each member's `tax_profile`, `help_debt`,
  `deduction` rows, concessional `super_contribution` rows, and taxable inflows
  for a financial year.
- Actual spend vs plan (reconciliation over the ledger tables) is a future
  phase, pending transaction ingestion beyond the gift category.
