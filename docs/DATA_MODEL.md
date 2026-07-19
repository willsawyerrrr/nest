# Data model

Relational, stack-agnostic. Amounts are integer minor units (cents), stored in
`bigint` columns. Financial years are AU FYs (1 Jul – 30 Jun), labelled by their
ending year. Row-Level Security is the isolation boundary: every table is scoped
to a `household_id`, and a member sees or changes only rows in a household they
belong to. Cross-household references are additionally blocked by composite
foreign keys on `(id, household_id)`.

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
    `type` (`salary` | `wage` | `other` | `reimbursement`),
    `taxable` (default true), `schedule`, `interval_weeks` (nullable),
    `amount_cents` (nullable), `hourly_rate_cents` (nullable),
    `hours_per_period` (nullable), `created_at`, `updated_at`.
  - `taxable` inflows feed the per-member tax estimate and require `member_id`;
    non-taxable inflows (e.g. reimbursements) add to available cash and may omit
    it.
  - `schedule` is the shared `frequency` enum: `weekly`, `fortnightly`,
    `monthly`, `quarterly`, `biannual`, `annual`, `every_n_weeks`. For
    `every_n_weeks`, `interval_weeks` holds N (≥ 1); it is null for every other
    schedule.
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

## Planning & goals

Budgeting is plan-only and fortnightly. There is no period-versioned budget and
no per-member scoping; each line stands alone under the household.

- **budget_line** — a planned recurring allocation within one fixed group.
  - `id`, `household_id`, `line_group`
    (`needs` | `wants` | `discretionary` | `savings` | `investments`), `name`,
    `amount_cents`, `frequency` (the shared enum above), `goal_id` (nullable),
    `created_at`, `updated_at`.
  - `goal_id` links to a savings goal; only `savings`/`investments` lines may
    set it. Many lines may fund one goal.
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
    `currency` (default `AUD`), `created_at`, `updated_at`.
  - `up-sync` upserts Up accounts on conflict `(source, external_id)`, so a
    saver's `balance_cents` stays current; a linked savings goal reads its balance
    from here. `service_role` holds `select`/`insert`/`update` for that upsert.
- **transactions** — a single ledger entry.
  - `id`, `household_id`, `account_id`, `member_id` (nullable, attribution),
    `category_id` (nullable), `posted_at`, `amount_cents` (signed, negative =
    outflow), `description`, `kind` (`income` | `expense` | `transfer`),
    `status` (`pending` | `settled`), `source` (`up` | `manual`),
    `external_id` (dedupe key), `notes`, `created_at`, `updated_at`.
- **categories** — hierarchical income/expense taxonomy.
  - `id`, `household_id`, `parent_id` (nullable, self-referential), `name`,
    `kind` (`income` | `expense`), `is_archived`, `created_at`, `updated_at`.

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
