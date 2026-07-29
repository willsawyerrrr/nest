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
    (nullable), `up_connected_at` (nullable), `created_at`, `updated_at`.
  - Unique on `(household_id, user_id)`. All members can manage everything in
    the household; member attribution elsewhere is a tax/reporting tag, not a
    permission.
  - `up_connected_at` records when the member's Up token was last stored (null =
    not connected). It is a non-sensitive status flag readable under the members
    RLS; the token itself lives only in Vault and is never exposed here. The
    token is stored/read/cleared solely by SECURITY DEFINER RPCs granted to
    `service_role` (`store_up_token` / `up_token_for_member` / `clear_up_token`).
    It is service-role-write-only: `authenticated` holds column-scoped UPDATE on
    `name`/`email` only, so a client cannot forge its Up connection status.
  - `service_role` holds the table grants the Up edge functions read under:
    `select` on `members` and `select`/`insert`/`update` on `accounts`, for member
    lookup and for resolving a synced transaction's account. The sync's writes go
    through SECURITY DEFINER RPCs (see RPCs) rather than these grants.

## Inflows

- **inflows** — projected recurring money in, split by taxability.
  - `id`, `household_id`, `member_id` (nullable), `name`,
    `type` (`salary` | `wage` | `other` | `reimbursement` | `hobby` | `gift`),
    `taxable` (default true), `attracts_super` (default true), `schedule`,
    `interval_count` (nullable), `amount_cents` (nullable),
    `hourly_rate_cents` (nullable), `hours_per_period` (nullable), `starts_on`
    (date, nullable), `ends_on` (date, nullable), `created_at`, `updated_at`.
  - `starts_on` / `ends_on` bound when the rate applies; both null means the
    whole year. A CHECK (`inflows_effective_dates`) requires
    `ends_on >= starts_on` where both are set. The tax estimate prorates each
    inflow's annual gross by its active share of the financial year in inclusive
    calendar days, so a mid-year pay rise is modelled as the old rate ending and
    a new dated inflow starting — see
    [`tax.md`](tax.md#effective-dated-income).
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
    for every fixed schedule. Periods-per-year and fortnightly/annual
    normalisation are canonical in
    [`budget-and-savings.md`](budget-and-savings.md#schedules--normalization).
  - Amount shape by `type`: `wage` carries `hourly_rate_cents` ×
    `hours_per_period` (and null `amount_cents`); every other type carries a
    flat `amount_cents` per period.

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
    `created_at`, `updated_at`.
  - `financial_year` is the year the expense is claimed in and is stored rather
    than derived from `deduction_date`, with no constraint tying the two: an
    expense incurred near a year boundary is claimed in whichever year the
    household lodges it. It is the FY scope every read filters on, so the Tax and
    EOFY tabs for a year see only that year's rows.
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
- **deduction_receipt** — a stored receipt file backing a deduction; many rows
  per deduction.
  - `id`, `deduction_id`, `household_id`, `storage_path`, `file_name`,
    `created_at`. No `updated_at`: a receipt row is written once with its upload
    and deleted rather than edited, so there is nothing to touch.
  - Composite FK `(deduction_id, household_id)` → `deduction (id, household_id)`
    `on delete cascade` — deleting a deduction takes its receipt rows with it.
    Indexed on `(deduction_id)` (the list read) and `(household_id)`.
  - `storage_path` is the object key in the private `receipts` bucket (see
    **Storage buckets**), laid out `<household_id>/<deduction_id>/<file>`. The
    leading household segment is load-bearing: the `storage.objects` policy
    matches it against `household_ids_for_current_user()`, so the file's access
    boundary is the row's rather than something separately administered.
    `file_name` keeps the original upload name for display, since the key itself
    is generated.
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
    super guarantee is charged on. The **largest earnings group's** inflow is also
    the pay cycle the slip's own withholding and concessional-super expectations
    are divided by — the slip carries no cadence of its own.
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
    (nullable), `created_at`, `updated_at`.
  - Funded by the budget lines that reference it via `goal_id`.
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
- **gift_purchase** — an actual purchase assigned to a `gift_budget`.
  - `id`, `household_id`, `gift_budget_id`, `amount_cents` (≥ 0),
    `description` (default `''`), `purchased_on`, `transaction_id` (nullable),
    `created_at`, `updated_at`.
  - Composite foreign key `(gift_budget_id, household_id)` → `gift_budget`
    `on delete cascade`.
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

**Private gifts.** `gift_recipient`, `gift_occasion`, and `gift_budget` carry the
shared blanket "household members manage" policy — the agreed budget is set
together and a recipient may see their own budgeted amount, and it still feeds the
derived Gifts budget line and pay splits unchanged. `gift_purchase` instead has
per-command policies gated on the caller not being the gift's recipient:
`SELECT`/`UPDATE`/`DELETE`/`INSERT` all require
`gift_budget_id not in (select hidden_gift_budget_ids_for_current_member())` (plus
household membership). `hidden_gift_budget_ids_for_current_member()` is a
`SECURITY DEFINER` helper returning the gift-budget ids whose recipient is linked
to one of the caller's members (mirroring `visible_balance_account_ids`), so a
member never reads and cannot log a purchase for their own surprise, while the
buyer — any other member — sees and manages it normally.

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
    `type` (`transaction` | `savings` | `credit` | `offset` | `other`),
    `source` (`up` | `manual`), `external_id`,
    `currency` (default `AUD`), `exclude_from_net_worth` (default `false` — a
    shared, household-wide flag that drops the account from net-worth totals
    only, leaving retirement projection and budgeting untouched), `created_at`,
    `updated_at`.
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
  `source` — never a balance. It carries shared accounts, the caller's own
  accounts, and any member's `transaction` account, so a co-member's spending
  account can be named as a budget-line funding destination and summed into the
  pay split without exposing its balance; a co-member's savers and super accounts
  are absent. A plain invoker view (`security_invoker = on`): it reads under the
  caller's own `accounts` RLS, then narrows to the directory rule.
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
  `reconcile_gift_total` (a recipient's gift budgets), and
  `reconcile_buyer_account` (the *other* member's `type = 'transaction'` account,
  which funds a "Gifts for &lt;member&gt;" line), with `reconcile_annual_cents`
  normalising an amount + frequency + interval to annual cents and
  `budget_line_derived_fields` resolving one line's group, name, amount, and
  destination.
- Six `AFTER` triggers named `reconcile_derived_lines` call it whenever a source
  changes, each narrowed to the columns that can move a roll-up:
  `breakdown_item` (insert/delete/update of `amount_cents`, `frequency`,
  `interval_count`, `breakdown_id`), `breakdown` (update of `name`,
  `line_group`), `gift_budget` (insert/delete/update of
  `budgeted_amount_cents`, `recipient_id`), `gift_recipient` (delete/update of
  `member_id`), `members` (insert/delete/update of `name`), and `accounts`
  (insert/delete/update of `owner_member_id`, `type`, `name` — the three columns
  that decide which account funds a gift line).
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
