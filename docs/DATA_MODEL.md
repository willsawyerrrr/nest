# Data model

Relational, stack-agnostic. Amounts are integer minor units (cents), stored in
`bigint` columns. Financial years are AU FYs (1 Jul – 30 Jun), labelled by their
ending year. Row-Level Security is the isolation boundary: every table is scoped
to a `household_id`, and a member sees or changes only rows in a household they
belong to. On top of membership, `accounts` and `transactions` add per-account
balance privacy — a co-member's own-account balance rows are not visible (see the
security model in [`ARCHITECTURE.md`](ARCHITECTURE.md#security)). Cross-household
references are additionally blocked by composite foreign keys on
`(id, household_id)`.

> The planning tables (inflows, budget lines, temporary items, savings goals)
> are described from the user's perspective in
> [`budget-and-savings.md`](budget-and-savings.md); tax inputs in
> [`TAX.md`](TAX.md). The `supabase/migrations/` files are authoritative.

## Household & members

- **households** — the shared container for a household's members and data.
  - `id`, `name`, `timezone` (default `Australia/Sydney`), `created_at`,
    `updated_at`.
  - `invite_code` (nullable, unique) and `invite_code_expires_at` (nullable) —
    a single-use, opt-in code a partner redeems to join. Both are null unless a
    member has generated one; it expires after 7 days and is consumed on join.
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
  - `service_role` holds the server-side table grants the Up edge functions
    need: `select` on `members` and `select`/`insert`/`update` on `accounts`,
    for member lookup and account-balance upserts.

## Inflows

- **inflows** — projected recurring money in, split by taxability.
  - `id`, `household_id`, `member_id` (nullable), `name`,
    `type` (`salary` | `wage` | `other` | `reimbursement` | `hobby` | `gift`),
    `taxable` (default true), `schedule`, `interval_count` (nullable),
    `amount_cents` (nullable), `hourly_rate_cents` (nullable),
    `hours_per_period` (nullable), `created_at`, `updated_at`.
  - `taxable` inflows feed the per-member tax estimate and require `member_id`;
    non-taxable inflows (reimbursement, hobby income, gift, or other) add to
    available cash and may omit it. For non-taxable inflows `type` is a reporting
    label only — taxability, not type, decides whether an inflow is taxed.
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
    `has_private_hospital_cover` (Medicare levy surcharge),
    `help_debt_cents` (HELP/HECS balance), `created_at`, `updated_at`.
  - Unique on `(member_id, financial_year)`.
- Versioned AU tax parameters (rates, thresholds) live in config, not a table —
  see [`TAX.md`](TAX.md).

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
    `goal_id` (nullable), `breakdown_id` (nullable), `destination_account_id`
    (nullable), `created_at`, `updated_at`.
  - `goal_id` links to a savings goal; only `savings`/`investments` lines may
    set it. Many lines may fund one goal.
  - `breakdown_id` marks a **derived line** whose amount is rolled up from a
    breakdown's items rather than typed by hand — see [Breakdowns](#breakdowns).
    Null is an ordinary manual line. Composite FK `(breakdown_id, household_id)` →
    `breakdown` `on delete cascade`.
  - `destination_account_id` routes the line to the Up account that funds it for
    the Splits tab — see [Pay splits](#pay-splits). Nullable composite FK
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
    (`breakdown_kind` enum: `generic` | `gift`, default `generic`), `created_at`,
    `updated_at`. Unique on `(id, household_id)`.
  - `kind` selects the editor and roll-up source: `generic` rolls up
    `breakdown_item` rows; `gift` rolls up the `gift_*` tables.
- **breakdown_item** — a line item of a `generic` breakdown (a `gift` breakdown
  owns none — its items live in `gift_budget`).
  - `id`, `household_id`, `breakdown_id`, `name`, `amount_cents`, `frequency`
    (the shared enum), `interval_count` (nullable — the same CHECK as
    `budget_line`), `created_at`, `updated_at`. Composite FK
    `(breakdown_id, household_id)` → `breakdown` `on delete cascade`.

The derived line's amount is the summed-annualised roll-up of the breakdown's
items and is read-only in every budget surface. The line exists only while the
breakdown has items (a routed line — one carrying a `destination_account_id` —
survives an empty breakdown so its Splits routing is not lost).
`budget_line.breakdown_id` is the sole derived-line mechanism: a non-null
`breakdown_id` marks the line as derived and owned by that breakdown, its amount
rolled up from the breakdown's items; a null `breakdown_id` is an ordinary
manual line.

### Gift tables

The `kind = 'gift'` breakdown keeps the bespoke gift planner: plan a spend per
**recipient × occasion**, then record the actual purchases against it. All four
tables are household-scoped under the ledger's RLS, with composite foreign keys on
`(id, household_id)` that keep every reference inside the household.

- **gift_recipient** — a named person the household budgets gifts for.
  - `id`, `household_id`, `name`, `created_at`, `updated_at`. Unique on
    `(id, household_id)`.
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
    `description` (default `''`), `purchased_on`, `created_at`, `updated_at`.
  - Composite foreign key `(gift_budget_id, household_id)` → `gift_budget`
    `on delete cascade`.

## Ledger

`accounts` is populated by the `up-sync` edge function for Up savers (see the Up
integration in [`ARCHITECTURE.md`](ARCHITECTURE.md)); a savings goal links to one
via `savings_goal.linked_account_id`. `transactions` and `categories` exist as
the target for transaction ingestion (Up Bank API + manual entry) but are not yet
populated; spending-plan reconciliation against them is a later phase.

- **accounts** — a bank or savings account.
  - `id`, `household_id`, `owner_member_id` (nullable = joint), `name`,
    `type` (`transaction` | `savings` | `credit` | `offset` | `other`),
    `source` (`up` | `manual`), `external_id`, `balance_cents`,
    `currency` (default `AUD`), `exclude_from_net_worth` (default `false` — a
    shared, household-wide flag that drops the account from net-worth totals
    only, leaving retirement projection and budgeting untouched), `created_at`,
    `updated_at`.
  - `up-sync` upserts Up accounts on conflict `(source, external_id)`, so a
    saver's `balance_cents` stays current; a linked savings goal reads its balance
    from here. `service_role` holds `select`/`insert`/`update` for that upsert.
  - **Balance privacy.** RLS returns the full row (including `balance_cents`) only
    for shared/joint accounts (`owner_member_id` null), the caller's own accounts,
    and household super accounts (those linked from a `super_profile`); a
    co-member's individual spending account and savers are excluded, so their
    balance is never returned. Inserts and updates are limited to shared or
    self-owned accounts.
- **account_directory** (view) — an identity-only surface over `accounts` for
  budgeting and splits: `id`, `household_id`, `owner_member_id`, `name`, `type`,
  `source` — never `balance_cents`. It carries shared accounts, the caller's own
  accounts, and any member's `transaction` account, so a co-member's spending
  account can be named as a budget-line funding destination and summed into the
  pay split without exposing its balance; a co-member's savers and other
  individual accounts are absent. A definer's-rights view (`security_invoker =
  off`).
- **transactions** — a single ledger entry.
  - `id`, `household_id`, `account_id`, `member_id` (nullable, attribution),
    `category_id` (nullable), `posted_at`, `amount_cents` (signed, negative =
    outflow), `description`, `kind` (`income` | `expense` | `transfer`),
    `status` (`pending` | `settled`), `source` (`up` | `manual`),
    `external_id` (dedupe key), `notes`, `created_at`, `updated_at`.
  - RLS gates each transaction to the balance-visible account set, so a member
    reads and writes transactions only on accounts whose balance they can see.
- **categories** — hierarchical income/expense taxonomy.
  - `id`, `household_id`, `parent_id` (nullable, self-referential), `name`,
    `kind` (`income` | `expense`), `is_archived`, `created_at`, `updated_at`.

## Pay splits

Each budget line routes to the Up account that funds it via
`budget_line.destination_account_id`; the Splits tab sums those into a recommended
fortnightly pay split per account. Up exposes no pay-split API, so the household
sets the split in Up by hand and confirms the amount app-side. See
[`pay-splits.md`](pay-splits.md).

- **pay_split** — the fortnightly split the household has confirmed as set in Up
  for one account.
  - `id`, `household_id`, `account_id`, `confirmed_fortnightly_cents`,
    `confirmed_at`, `created_at`, `updated_at`.
  - `unique (household_id, account_id)` keeps it one-per-account; composite FK
    `(account_id, household_id)` → `accounts` `on delete cascade`. The Splits tab
    compares the recommendation against this to surface drift and offer a Confirm.

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
- `household_ids_for_current_user()` — the households the caller belongs to;
  the basis for every RLS policy.
- `current_member_ids()`, `household_super_account_ids()`, and
  `visible_balance_account_ids()` — the SECURITY DEFINER helpers behind per-account
  balance privacy: the caller's member ids, the household's super-linked account
  ids, and the account ids whose balance the caller may see (shared, own, or
  super) — the last gating the `transactions` policies without recursing through
  the `accounts` policies.

The Up token RPCs are also `SECURITY DEFINER`, but granted to `service_role`
alone (not `authenticated`) — they are the only path to the token, which lives in
Vault:

- `store_up_token(member_id, token)` — upsert the token into Vault under
  `up_token:<member_id>` and stamp `members.up_connected_at`.
- `up_token_for_member(member_id)` — return the decrypted token (server-side
  sync only).
- `clear_up_token(member_id)` — delete the Vault secret and null
  `up_connected_at`.

## Derived / computed (not stored)

- Planned spend per group and the live remaining buffer: projected after-tax
  income less budget-line allocations and temporary-item contributions,
  normalised to a common period from each line's `frequency`.
- Savings-goal progress and required contribution rate: `current_balance_cents`
  against `target_amount_cents` and `target_date`, projected from the summed
  contributions of the budget lines funding it.
- Tax estimate: the tax engine over each member's `tax_profile` and taxable
  inflows for a financial year.
- Actual spend vs plan (reconciliation over the ledger tables) is a future
  phase, pending transaction ingestion.
