# Data model

Relational, stack-agnostic. Amounts are integer minor units (cents), stored in
`bigint` columns. Financial years are AU FYs (1 Jul – 30 Jun), labelled by their
ending year. Row-Level Security is the isolation boundary: every table is scoped
to a `household_id`, and a member sees or changes only rows in a household they
belong to. On top of membership, `accounts` and `transactions` add per-account
balance privacy — a co-member's own-account balance rows are not visible (see the
security model in [`architecture.md`](architecture.md#security)). Cross-household
references are additionally blocked by composite foreign keys on
`(id, household_id)`.

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
    → accounts (id, household_id)` `on delete set null` keeps it within the
    household and clears it if the account is removed. Written only through the
    `set_household_pay_account` RPC (see RPCs), not a broad households update.
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
  - Composite FK on `(member_id, household_id)` → `members`. Vesting and
    valuation are computed client-side by `@nest/plan` (`vestedQuantity`,
    `grantValueCents`); the vested value seeds the Net worth tab as an asset.
    Edited on the Equity tab.
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

`accounts` is populated by the `up-sync` edge function for Up savers (see the Up
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

Because these RPCs run as their owner, `service_role` needs no grant on the
tables they write; the surgical grant stance is in
[`operations.md`](operations.md#service_role-grants).

## Derived / computed (not stored)

- Planned spend per group and the live remaining buffer: projected after-tax
  income less budget-line allocations and temporary-item contributions,
  normalised to a common period from each line's `frequency`.
- Savings-goal progress and required contribution rate: `current_balance_cents`
  against `target_amount_cents` and `target_date`, projected from the summed
  contributions of the budget lines funding it.
- Tax estimate: the tax engine over each member's `tax_profile`, `help_debt`, and
  taxable inflows for a financial year.
- Actual spend vs plan (reconciliation over the ledger tables) is a future
  phase, pending transaction ingestion beyond the gift category.
