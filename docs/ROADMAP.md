# Roadmap

Phased so each phase is independently useful. The plan-only app (income, tax,
budget, savings goals) is built and deployed — it fully replaces the household's
spreadsheet and needs no transaction data. The Up savers → savings-goals slice
is built and deployed on top of it. Next is full superannuation modelling, which
extends the tax engine and seeds a net-worth view; Up transaction ingestion —
reconciling spend and actual tax paid against the plan — follows as a later
phase.

## Product decisions

- **Single shared household; money fully pooled.** No per-person budgets, no
  splitting, no "who owes whom".
- **All household members manage everything** — RLS is gated on household
  membership only; member attribution on a record is a tax/reporting tag, not a
  permission.
- **Money-in is modelled as inflows.** The household owns many projection-based
  inflows, each on a schedule — weekly, fortnightly, monthly, quarterly,
  biannual, annual, or an arbitrary "every N weeks" cadence — split by
  taxability:
  - **Taxable income** — a salary (annual gross), a wage (rate × standard hours),
    or other regular income, each tagged to a member and feeding the tax estimate
    (AU tax is assessed per person).
  - **Non-taxable inflows** — money in excluded from tax (e.g. a work
    reimbursement) that adds directly to available cash; no member tag required,
    and more kinds are expected.

  Inflows are projections, not reconciled against actual deposits. Future
  enhancement: assign an inflow to a budget category to net against that spend.
- **Tax is estimate-only.** Per-person estimated liability and take-home from
  projected income; models HELP repayment and private-hospital cover. Target
  financial year: FY2027. Tracking actual tax paid arrives with ingestion.
- **Superannuation is modelled in full.** Per-person super: current balance,
  employer SG (12% from FY2026), and salary-sacrifice / personal contributions.
  Concessional contributions reduce taxable income and are taxed at 15% within
  the fund, with Division 293 for high earners; concessional and non-concessional
  caps (with carry-forward / bring-forward) and the government co-contribution are
  modelled. Balances are tracked as assets, seeding a net-worth view, and project
  to retirement under user-editable return assumptions. All caps and thresholds
  live in the versioned per-FY config alongside the tax config.
- **Budgeting is plan-only and fortnightly.** The household allocates projected
  after-tax income across grouped categories — Needs, Wants, Discretionary,
  Temporary, Savings, Investments — each line an amount + frequency normalised to
  a fortnight, with a live remaining buffer (granular, not strictly zero-based).
  Needs = regular essentials; Wants = regular quality-of-life; Discretionary =
  non-regular discretionary purchases; Temporary = short-term/one-off items that
  expire.
- **Ingestion is the reconciliation layer.** Both partners bank with Up; pulling
  actual transactions reconciles spend and goal progress against the plan, and
  reconciles actual tax paid against the estimate.

## Done

### Foundations & platform

- Stack, monorepo scaffold, Vercel hosting, `main` protection ruleset.
- CI split into parallel `check` / `test` / `rls` / `functions` jobs (all
  required; the `test` job sharded across runners; under a minute).
- Household, members, and RLS isolation (schema + automated CI tests).
- Onboarding + first-run gating; Google OAuth; partner join via a temporary,
  opt-in, single-use invite code (`create_invite_code` / `join_household` /
  `revoke_invite_code`).
- Ledger schema: accounts, transactions, categories (schema only).

### Plan-only app (complete — replaces the household's spreadsheet)

- Income + tax-profile schema.
- Verified FY2027 tax config + marginal HELP model; the pure `@budget/tax`
  engine (`configsByYear`).
- Inflows model: taxable / non-taxable split, member-tagged taxable income,
  schedules from weekly through annual plus an arbitrary "every N weeks" cadence
  (`interval_weeks`); only taxable inflows feed the tax estimate.
- Income + tax-estimate UI: inflow management and the tax view (per-person
  breakdown + household take-home, annual and fortnightly, as per-card tables).
  Tax profiles are edited on the Household tab.
- Budget, savings-goal, and temporary-item schema (RLS, tests, types).
- `@budget/plan` pure math package: schedule normalization, summary
  reconciliation, goal projection, temporary expiry.
- Budget UI: grouped-line CRUD (Needs / Wants / Discretionary / Temporary /
  Savings / Investments), each line amount + frequency normalised to a fortnight,
  with a universal "Add item" button, search, and sort (Default / Name / Amount +
  direction, persisted to localStorage). Budget groups and Temporary items share
  a `GroupSection`.
- Summary / reconciliation UI: an allocation donut with Income / Outgoing /
  Remaining totals and per-line portions; after-tax income + non-taxable inflows
  − outgoings − savings block = remaining buffer, with each group's fortnightly /
  annual / portion and running After Outgoing / After Saving totals; savings
  groups render after "After Outgoing".
- Goals UI: target amounts and dates, manual current balance, projected progress
  + ETA; Savings lines linked to a goal; goals with active contributions list
  first.
- Mantine mobile-first restyle; two-decimal money formatting.
- Navigation: path-routed tabs via `react-router-dom` (`/summary` `/inflows`
  `/budget` `/goals` `/tax` `/household`; `/` and unknown routes redirect to
  `/summary`), so tabs are deep-linkable and reload-safe. Summary is the landing
  tab; order Summary · Inflows · Budget · Goals · Tax · Household. Keyboard
  shortcuts: ⌘/Ctrl+1–6 jump to a tab, ⌘/Ctrl+Shift+←/→ cycle.
- Per-member Up token connection: each member pastes their Up personal access
  token, validated against Up and stored encrypted in Vault. The token is written
  and read only via SECURITY DEFINER RPCs granted to `service_role` alone
  (`store_up_token` / `up_token_for_member` / `clear_up_token`), never returned to
  the client; members see a boolean status (`members.up_connected_at`). Two
  JWT-verified edge functions (`up-connect` / `up-disconnect`) resolve the caller's
  member from the JWT and connect/clear the token. Household-tab UI for connect,
  disconnect, and per-member status.

### Up savers → savings goals (complete)

Savings-goal progress is funded from Up saver balances. The per-member token
connection is the foundation; transaction ingestion stays deferred behind it.

- Saver balances read server-side: `up-sync` enumerates connected members
  (`up_connected_at` set), reads each token via `up_token_for_member` as service
  role, and upserts their Up accounts into `public.accounts` on conflict
  `(source, external_id)` — idempotent, joint accounts shared (owner null),
  individual accounts attributed to the member. Transaction sync is deferred to
  the ledger phase below.
- Goals reflect real saver balances (progress + ETA): a goal carries a nullable
  `linked_account_id`; the goal form offers an "Up saver" picker from the
  household's synced savers (selecting one prefills an empty goal name with the
  saver's name), and a linked goal draws its current balance from the saver's
  `balance_cents` for progress, ETA, and display, falling back to the manual
  `current_balance_cents` when unlinked.
- Balances stay fresh on demand and on a schedule: a **Refresh** button on the
  Goals tab invokes `up-sync` with the member's JWT, which scopes the run to the
  caller's household and refetches savers + goals. An hourly `pg_cron` job
  (`up-sync-hourly`) POSTs to `up-sync` via `pg_net` with the service-role key as
  a backstop, syncing every connected household; `up-sync` tells the cron caller
  from a member's by the bearer JWT's `role` claim. The schedule migration is
  guarded on pg_cron + pg_net and reads the invocation URL/key from Vault, so it
  is a clean no-op where those extensions are absent (CI, plain Postgres) and
  takes deploy-time config in prod (see HANDOFF).

## Now — Superannuation (full picture)

Full AU super modelling, extending the tax engine and seeding a net-worth view.
Sub-phased so each slice is independently useful, and sliced further
(schema / logic / UI) to keep PRs small. All rates, caps, and thresholds live in
the versioned per-FY config, verified as the FY2027 tax config was.

- [x] Super profile schema: per-member `super_profile` (fund, SG-rate override,
      linked balance account, manual carry-forward cap) plus a
      `super_contribution` child table (kind, amount-or-percent, schedule, FHSS
      flag, spouse contributor). Balance is held as a linked account, not a
      column. RLS + isolation tests; types regenerate with the first consumer.
- [ ] Balances as assets: surface each person's super balance as an asset,
      seeding the net-worth view.
- [ ] Tax integration (`@budget/tax`): concessional contributions (salary
      sacrifice + personal deductible) reduce taxable income; 15% contributions
      tax within the fund; Division 293 extra 15% where income + concessional
      contributions exceed $250k.
- [ ] Contribution caps + co-contribution: concessional cap ($32,500 for
      FY2027) with carry-forward when total super balance < $500k;
      non-concessional cap ($130,000 for FY2027) with bring-forward (up to
      $390,000); the government co-contribution income test. Exact figures are
      FY-specific and live in the versioned config.
- [ ] Retirement projection (pure math): projected balance at preservation age
      under user-editable return, inflation, and contribution-growth assumptions.
- [ ] Super UI: per-person management + display, with tax impact and projection
      surfaced.

## Later

- **Spreadsheet-parity gaps** ([`spreadsheet-parity.md`](spreadsheet-parity.md)):
  itemised sub-budget (line-item breakdown, e.g. the gift budget),
  payment-method tag per budget line, a wishlist, and a finance-admin to-do list.
  Small and low-risk; good HDD filler to interleave with the super phase.
- **Up ledger + reconciliation.** Pulling actual Up transactions to reconcile
  spend and tax against the plan — the heaviest phase, deferred behind super:
  - [ ] Account/transaction sync: webhook + scheduled poll; dedupe on
        `external_id`.
  - [ ] Ledger UI (accounts + transactions) over synced data.
  - [ ] Reconcile actual spend against the budget.
  - [ ] Track actual tax paid (PAYG withheld) for a refund/bill vs the estimate.
- Reconcile projected income against actual deposits; joint-income ownership
  split; net worth (assets and liabilities) beyond super; recurring bills and
  forecasting; non-resident and part-year tax; notifications; additional bank
  sources / CSV.
