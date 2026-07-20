# Roadmap

Phased so each phase is independently useful. The plan-only app (income, tax,
budget, savings goals) is built and deployed — it fully replaces the household's
spreadsheet and needs no transaction data. The Up savers → savings-goals slice is
built and deployed on top of it. Full superannuation modelling — which extends the
tax engine and seeds a net-worth view — is complete, as is gift budget tracking
(the first derived-budget-line consumer). Next is Up transaction ingestion:
reconciling spend and actual tax paid against the plan.

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
  - **Non-taxable inflows** — money in excluded from tax (reimbursement, hobby
    income, gift, or other) that adds directly to available cash; no member tag
    required, and the type is a reporting label only.

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
  to retirement under user-editable return assumptions. Each balance is a dated
  baseline that auto-accrues the member's modelled contributions between manual
  true-ups, so it stays current under payday super with no external integration.
  All caps and thresholds live in the versioned per-FY config alongside the tax
  config.
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
- Verified FY2027 tax config + marginal HELP model; the pure `@nest/tax`
  engine (`configsByYear`).
- Inflows model: taxable / non-taxable split, member-tagged taxable income,
  schedules from weekly through annual plus an arbitrary "every N weeks" cadence
  (`interval_weeks`); only taxable inflows feed the tax estimate.
- Income + tax-estimate UI: inflow management and the tax view (per-person
  breakdown + household take-home, annual and fortnightly, as per-card tables).
  Each member card shows a full component breakdown — income tax, Low Income Tax
  Offset, Medicare levy, surcharge, HELP/HECS repayment, and Division 293 tax
  building up to the total, with a footnote that capital gains tax is out of scope
  and not modelled. Tax profiles are edited on the Household tab.
- Budget, savings-goal, and temporary-item schema (RLS, tests, types).
- `@nest/plan` pure math package: schedule normalization, summary
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
- Mantine mobile-first restyle; two-decimal money formatting; `primaryColor:
  'teal'` with green/red money semantics and a recoloured Summary donut.
- Navigation: path-routed tabs via `react-router-dom` (`/summary` `/net-worth`
  `/inflows` `/budget` `/splits` `/goals` `/tax` `/super` `/gifts` `/household`;
  `/` and unknown routes redirect to `/summary`), so tabs are deep-linkable and
  reload-safe. Summary is the landing tab; order Summary · Net worth · Inflows ·
  Budget · Splits · Goals · Tax · Super · Gifts · Household. One `NAV_ITEMS` table
  drives a responsive top app-bar + hamburger `Drawer` on mobile and a persistent
  left sidebar on desktop. Keyboard shortcuts: ⌘/Ctrl+1–9 jump to the first nine
  tabs, ⌘/Ctrl+Shift+←/→ cycle.
- Desktop layout: content capped at a 50rem max-width; budget lines and inflows
  render as dense single rows on desktop while mobile keeps cards.
- Non-taxable inflow types: `inflow_type` carries `reimbursement`, `hobby`,
  `gift`, and `other`; the inflow form offers the type on the non-taxable branch.
  The type is a reporting label and does not affect tax.
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

- Account balances read server-side: `up-sync` enumerates connected members
  (`up_connected_at` set), reads each token via `up_token_for_member` as service
  role, and upserts every Up account — savers and spending accounts alike — into
  `public.accounts` on conflict `(source, external_id)` — idempotent, joint
  accounts shared (owner null), individual accounts attributed to the member. A
  joint account surfaces through both partners' tokens under the same Up id; the
  run processes it once (first sighting) so its shared ownership is not rewritten
  by whichever member syncs last. An individual spending account (typically just
  "Spending", colliding across members) is stored with its name prefixed by the
  owner's name in possessive form (e.g. "Alex's Spending"), recomputed from Up's
  `displayName` each sync so repeated runs never double-prefix; joint accounts and
  savers keep Up's name. Transaction sync is deferred to the ledger phase below.
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

### Superannuation & net worth (complete)

Full AU super modelling, extending the tax engine and seeding a net-worth view.
All rates, caps, and thresholds live in the versioned per-FY config, verified as
the FY2027 tax config was.

- [x] Super profile schema: per-member `super_profile` (fund, SG-rate override,
      linked balance account, manual carry-forward cap) plus a
      `super_contribution` child table (kind, amount-or-percent, schedule, FHSS
      flag, spouse contributor). Balance is held as a linked account, not a
      column. RLS + isolation tests; types regenerate with the first consumer.
- [x] Balances as assets: surface each person's super balance as an asset,
      seeding the net-worth view.
- [x] Auto-accruing balance: the stored balance is a dated baseline
      (`super_profile.balance_as_of`), and the effective current balance =
      baseline + the member's modelled net contributions accrued since that date
      (contributions only — no investment growth), so it stays current under
      payday super with no external integration. Saving is a "true-up" that
      re-confirms the actual balance and resets the as-of date to today. The Super
      tab shows the effective balance with a baseline + accrued breakdown; the Net
      worth tab totals super accounts at their effective balance.
- [x] Tax integration (`@nest/tax`): concessional contributions (salary
      sacrifice + personal deductible) reduce taxable income; 15% contributions
      tax within the fund; Division 293 extra 15% where income + concessional
      contributions exceed $250k. The Tax tab resolves each member's concessional
      total from their contribution rows (amount annualised by frequency, percent
      applied to gross salary) and shows the concessional and Division 293 lines.
- [x] Contribution caps + co-contribution: concessional cap ($32,500 for
      FY2027) with carry-forward when total super balance < $500k;
      non-concessional cap ($130,000 for FY2027) with bring-forward (up to
      $390,000); the government co-contribution income test. Exact figures are
      FY-specific and live in the versioned config. The Super tab shows each
      member's cap usage, warns when either cap is exceeded, and estimates the
      government co-contribution.
- [x] Retirement projection (pure math): `projectSuperBalance` in `@nest/plan`
      compounds the current balance and a growing-annuity contribution stream to
      retirement, in nominal and today's (real) dollars, under user-editable
      return, inflation, and contribution-growth assumptions.
- [x] Super UI: per-person contribution management + display on the Super tab,
      with the concessional tax impact surfaced on the Tax tab.
- [x] Projection UI: the retirement projection surfaced in the Super tab, per
      member, from their balance plus net-of-contributions-tax annual
      contributions. Age (per member) and the shared return/inflation/growth and
      retirement-age assumptions are client-side inputs persisted in localStorage
      — not stored in the database.

### Gift budget tracking (complete)

The first consumer of derived budget lines (the generic concept is kept in Later).
A dedicated gift planner + tracker, richer than the spreadsheet's plan-only Gifts
sheet, with the household's real gift budgets loaded in production.

- [x] Schema (generic + gifts): the `budget_derived_source` enum, the nullable
      `budget_line.derived_source` column, and the four gift tables
      (`gift_recipient`, `gift_occasion`, `gift_budget` with an optional per-pairing
      `event_date`, `gift_purchase`), with RLS + isolation tests and regenerated
      types.
- [x] Gifts tab: plan a spend per **recipient × occasion**, then record purchases
      against it. Two-way collapsible grouping (by occasion or by person, default
      collapsed), each group rolling up budgeted / spent / remaining, reusing the
      Budget tab's `GroupSection`. The effective date is
      `event_date ?? occasion.occasion_date`.
- [x] Derived budget line: a single `derived_source = 'gift'` line per household
      takes its annual amount from the sum of every `gift_budget.budgeted_amount_cents`;
      the Budget tab and the Summary both substitute it, so the line and the tracker
      never drift.

### Pay splits (complete)

Keeping the household's Up pay splits aligned with the budget. See
[`pay-splits.md`](pay-splits.md) for the full design (including why Up's
read-only API keeps the confirmed split app-side).

- [x] Schema: `budget_line.destination_account_id` (nullable composite FK to
      `accounts` on `(id, household_id)`, mirroring `goal_id`) with the
      `budget_line_destination_group` check barring a destination on
      Savings/Investments lines, which route via their goal instead; and
      `pay_split` (one row per account, `unique (household_id, account_id)`)
      holding the household's confirmed fortnightly split. RLS + isolation test,
      regenerated types.
- [x] Pure logic (`@nest/plan`): `resolveDestinationAccountId` (Savings/Investments
      route through their goal's linked account, every other line through its own
      destination), `assignmentsByAccount` (per-account fortnightly totals plus an
      unassigned bucket), `roundCentsUpToStep` (round up to the nearest $5), and
      `paySplitNeedsUpdate` (whether the recommendation has drifted from the
      source-agnostic configured split).
- [x] Budget-line form: a "Funded from" account picker on
      non-Savings/Investments lines; Savings/Investments show the goal-derived
      route instead.
- [x] Splits tab (between Budget and Goals): per-account recommended fortnightly
      split rounded up to the nearest $5, an Unassigned nudge for unrouted lines,
      and per-saver drift against the confirmed split — a flagged row shows the
      change and a Confirm that records the new amount.

## Now — Up ledger + reconciliation

Pulling actual Up transactions to reconcile spend and tax against the plan — the
heaviest phase, and the current focus now that the plan-only app, Up savers, super,
and gifts are shipped.

- [ ] Account/transaction sync: webhook + scheduled poll; dedupe on `external_id`.
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget.
- [ ] Track actual tax paid (PAYG withheld) for a refund/bill vs the estimate.

## Later

- **Spreadsheet-parity gaps** ([`spreadsheet-parity.md`](spreadsheet-parity.md)):
  a generic itemised sub-budget (line-item breakdown) for non-gift lists, a
  payment-method tag per budget line, a wishlist, and a finance-admin to-do list.
  Small and low-risk; good HDD filler. (The gift budget is built — see Done.)
- **Derived budget lines** (generic concept). A budget line whose amount is
  **rolled up from an itemised tracker** instead of typed by hand, so the line and
  its detail share one source of truth and never drift. `budget_line.derived_source`
  (the `budget_derived_source` enum) names the source; null is an ordinary manual
  line, and the summary math honours a derived line's source in place of its typed
  amount. Extensible — each consumer adds an enum value and its own tables. The
  enum is a deliberate simplification: each new source needs a migration plus
  roll-up code; a registry/polymorphic design is deferred until sources proliferate.
  The **gift tracker** is the shipped first consumer (Done). Remaining directions:
  - **Health / medication tracking** (planned second consumer). Medications with
    dose / frequency / unit cost roll up to a recurring cost that feeds a Needs
    budget line via a new `derived_source` value — the same mechanism, a different
    tracker.
  - **Private / surprise gifts** (deferred). Hiding a gift one partner buys for the
    other needs per-member visibility on gift records, a departure from the
    household-only RLS model where every member sees everything. It would require
    member-scoped policies (and UI) that no other part of the app has, so it is out
    of scope for now.
  - **Up-tagged gift purchases.** Once Up ingestion lands, an Up transaction can be
    tagged to a gifting event instead of hand-entering the purchase.
- **Auto-fetch real super balances via CDR.** Replace the periodic manual
  true-up by pulling each fund's actual balance directly, once superannuation
  enters the Consumer Data Right. Super is not in CDR scope today (CDR covers
  banking and energy, with super flagged for a future designation but not
  designated); screen-scraping aggregators exist but are B2B and being phased out
  as CDR expands. So contribution-based accrual is the pragmatic path until CDR
  covers super, at which point a true-up could be automated from the real balance.
- Reconcile projected income against actual deposits; joint-income ownership
  split; net worth (assets and liabilities) beyond super — the Net worth tab totals
  assets only today; recurring bills and forecasting; non-resident and part-year
  tax; notifications; additional bank sources / CSV.
