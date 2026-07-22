# Roadmap & ideas

The single backlog for this project — there are no GitHub issues, so everything
lives here. Commitment decreases down the page: **Done** is shipped, and
everything below it — **Later**, then the **Ideas backlog** — is a ranked,
uncommitted wish-list of varying likelihood. All future work is phased so each
phase is independently useful.

## Product decisions

The locked product/scope decisions are canonical in
[`CLAUDE.md`](../CLAUDE.md#fixed-scope-decisions) — single shared household with
money fully pooled, projection-based inflows split by taxability, estimate-only
AU tax, full super modelling, a plan-only fortnightly budget, and Up ingestion as
the reconciliation layer. This roadmap phases the delivery of those decisions; it
does not restate them.

## Done

### Foundations & platform

- Stack, monorepo scaffold, Vercel hosting, `main` protection ruleset.
- Frontend shell: `App.tsx` is a thin auth gate + onboarding branch + routed
  shell, each tab a `routes/*Section.tsx` container; server state flows through a
  household-scoped TanStack Query cache built on one `useHouseholdCollection`
  factory, so tab switches render cached data and background-revalidate.
- CI split into parallel `check` / `test` / `rls` / `functions` jobs behind a
  `ci-status` aggregate (the single required `CI Status` check; under a minute),
  with sharded coverage gating and static import-sort / file-size gates — see
  [`architecture.md`](architecture.md#ci).
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
  schedules from weekly through annual plus an arbitrary "every N weeks" or
  "every N months" cadence (`interval_count`); only taxable inflows feed the tax
  estimate.
- Income + tax-estimate UI: inflow management and the tax view (per-person
  breakdown + household take-home, annual and fortnightly, as per-card tables).
  Each member card shows a full component breakdown — income tax, Low Income Tax
  Offset, Medicare levy, surcharge, HELP/HECS repayment, and Division 293 tax
  building up to the total, with a footnote that capital gains tax is out of scope
  and not modelled. Tax profiles are edited on the Household tab; each member's
  HELP/HECS balance is edited on the HELP debt tab.
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
  `/inflows` `/budget` `/splits` `/goals` `/tax` `/super` `/help-debt`
  `/breakdowns` `/household`; `/` and unknown routes redirect to `/summary`), so
  tabs are deep-linkable and reload-safe. Summary is the landing tab; order
  Summary · Net worth · Inflows · Budget · Splits · Goals · Tax · Super · Help
  debt · Breakdowns · Household. The gift planner is reached from the Breakdowns
  list (`/breakdowns/:id` for the gift breakdown), not a standalone tab. One
  `NAV_ITEMS` table drives a responsive top app-bar + hamburger `Drawer` on mobile
  and a persistent left sidebar on desktop. Keyboard shortcuts: ⌘/Ctrl+1–9 jump to
  the first nine tabs, ⌘/Ctrl+Shift+←/→ cycle.
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
  takes deploy-time config in prod (see
  [`operations.md`](operations.md#up-sync-hourly-cron-prod-only)).

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

### Breakdowns — derived budget lines (complete)

User-created itemised lists that each own one derived budget line, so a line and
its detail are a single source of truth. Breakdowns are data, not a fixed enum:
gifts and medications are breakdown rows the household creates, `kind` selecting
the editor. The household's real gift budgets are loaded in production. See
[`breakdowns.md`](breakdowns.md) for the full design.

- [x] Schema: `breakdown` (name / `line_group` / `breakdown_kind`) and
      `breakdown_item` (name / amount / frequency), plus `budget_line.breakdown_id`
      owning the derived line, with RLS + isolation tests and regenerated types.
      The four gift tables (`gift_recipient`, `gift_occasion`, `gift_budget` with
      an optional per-pairing `event_date`, `gift_purchase`) back the
      `kind = 'gift'` breakdown.
- [x] Breakdowns tab (`/breakdowns`): lists every breakdown with its group and
      fortnightly + annual total, and a New breakdown action. `/breakdowns/:id` is
      the editor, chosen by `kind` — a generic item editor, or the gift planner.
- [x] Gift planner (`kind = 'gift'`): plan a spend per **recipient × occasion**,
      then record purchases against it. Two-way collapsible grouping (by occasion
      or by person, default collapsed), each group rolling up budgeted / spent /
      remaining, reusing the Budget tab's `GroupSection`. The effective date is
      `event_date ?? occasion.occasion_date`.
- [x] Derived-line lifecycle (`reconcileBreakdownLines`): the line exists iff the
      breakdown has items, its amount is the summed-annualised roll-up
      (`applyBreakdownAmounts`), and its group and name track the breakdown. A
      routed line survives an empty breakdown so its Splits routing is not lost.
      The Budget tab and Summary read the derived amount, so line and detail never
      drift.
- [x] Sole mechanism: `budget_line.breakdown_id` is the only derived-line marker —
      there is no separate derived-source enum or column.

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

### Changelog — "What's new" (complete)

An in-app changelog so the household can see what has shipped and what is on the
way, sourced at runtime from GitHub for the private repo.

- [x] JWT-verified `changelog` edge function proxying the GitHub REST API with a
      token held as the `GITHUB_CHANGELOG_TOKEN` function secret (never sent to
      the client); degrades to `configured: false` when the secret is unset.
- [x] Pure `parseChangelogSubject` keeps only user-facing Conventional Commit
      types (feat / fix / perf), parses the optional scope, and strips the
      trailing ` (#123)` PR-number suffix.
- [x] **What's new** tab: **In progress** (open PRs) and **Implemented**
      (merged-commit subjects on `main`), each entry a type badge — Feature / Fix
      / Improvement — with the scope as a dimmed tag.

## Later

Uncommitted work, roughly ordered by likelihood of being picked up.

- **Spreadsheet-parity gaps** ([`spreadsheet-parity.md`](spreadsheet-parity.md)):
  a wishlist of per-member aspirational purchases. Small and low-risk; good HDD
  filler. (Gift budgets and generic itemised sub-budgets are built as breakdowns —
  see Done.)
- **Breakdowns follow-ups** (the feature itself is shipped — see Done). See
  [`breakdowns.md`](breakdowns.md).
  - **Private / surprise gifts** (deferred). Hiding a gift one partner buys for the
    other needs per-record member visibility on gift breakdowns — a finer-grained
    carve-out than the per-account balance privacy, which hides a whole owned
    account rather than individual rows within otherwise-shared data. It would
    require member-scoped policies and UI on the gift tables, so it is out of scope
    for now.
  - **Up-tagged gift purchases.** Once Up ingestion lands, an Up transaction can be
    tagged to a gifting event instead of hand-entering the purchase.
- Reconcile projected income against actual deposits; joint-income ownership
  split; recurring bills and forecasting; non-resident and part-year tax.

### Up ledger + reconciliation

A large, deprioritised phase that pulls actual Up transactions to reconcile spend
and tax against the plan. See [`up-ledger-sync.md`](up-ledger-sync.md) for the
full design (staged sync foundation, ledger UI, and the two reconciliation
layers).

- [ ] Account/transaction sync: webhook + scheduled poll; dedupe on `external_id`.
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget.
- [ ] Track actual tax paid (PAYG withheld) for a refund/bill vs the estimate.

## Ideas backlog

A brainstorm of integrations and native features that would extend this app
beyond its current plan-only + Up-ingestion scope. Ideas only — nothing here is
committed, and likelihood varies. Each entry notes user value, rough effort
(S/M/L), what it touches (external API + where the secret lives / schema-or-backend
change / frontend-only), dependencies, and feasibility notes. Skim the headings,
then see **My top picks** at the end.

Recurring shorthand:

- **Vault** = a secret stored in Supabase Vault, fetched only by an edge
  function — the exact pattern already specced for Up personal-access tokens.
- **Ingestion** = the Up ledger + reconciliation phase in **Later**: per-member
  Up token, webhook + scheduled poll, dedupe on `external_id`, transactions mapped
  into the shared ledger. Several ideas are blocked on it.
- Money is always integer cents; every domain row carries `household_id` for
  RLS.

### Integrations

#### 1. incident.io on-call schedule → on-call pay forecasting

- **What / value.** The user's on-call payment is currently modelled as an
  `every_n_weeks` inflow with N ≈ the team rotation size — a rough proxy that
  drifts as soon as a shift is swapped, a public holiday shifts a rotation, or
  the roster changes. Integrating incident.io's schedules/on-call API reads the
  _actual_ rotation, so the app can show a concrete **"next on-call payment:
  <date>, ~$X"** instead of an averaged cadence. It sharpens near-term
  cash-flow accuracy (the buffer knows exactly which fortnight the money lands
  in) and, once ingestion works, lets expected on-call pay be reconciled
  against what actually hit the Up account.
- **Effort.** M — one edge function + a small schedule-derived inflow type and
  a read-only "upcoming on-call" panel. The forecasting math is easy; the
  fiddly part is mapping rotation entries to pay events and pay dates (shift
  worked in period P is usually paid in a later payroll run).
- **Touches.** External API (incident.io REST — `Schedules` / on-call entries)
  + auth: an API key in **Vault**, fetched by an edge function (same pattern as
  Up tokens; never exposed to the client). New/derived inflow flavour
  ("schedule-driven inflow") so a forecast inflow can carry concrete dated
  occurrences rather than only a cadence — a schema addition, or a derived
  read-model that leaves the stored inflow as-is. Frontend: an upcoming-shifts
  card, likely on Inflows or Summary.
- **Dependencies.** Forecast display works standalone. Expected-vs-received
  reconciliation needs **ingestion** first.
- **Feasibility / risks.** incident.io has a documented REST API with a
  schedules/on-call surface and API-key auth, so the fetch is straightforward.
  Real modelling risk is the _pay_ side, not the _roster_ side: on-call
  allowance rates, whether weekends/public holidays pay differently, and the
  lag between working a shift and being paid for it all have to be encoded
  (probably a small user-configured "on-call pay rule": $ per weekday shift, $
  per weekend/holiday shift, pay-run offset). Timezone care around shift
  boundaries. The user must be able to generate an API key with schedule read
  scope.
- **Alternatives (same capability).** **PagerDuty** (schedules API, API-token
  or OAuth) and **Opsgenie** (on-call/schedule API) offer equivalent rosters —
  worth abstracting behind one "on-call source" adapter (mirroring the
  source-agnostic import boundary) so the pay-forecast logic is provider-neutral
  and the user picks whichever their team actually uses.

#### 2. Payslip / PAYG ingestion (actual withheld vs the estimate)

Design: [`payslips.md`](payslips.md). The income-side complement to the Up
ledger's spend-side actual-tax-paid tracking in **Later**.

- **What / value.** The tax engine already has a slot for `paye_withheld_cents`
  and computes a balance (owing vs refund) against it, but nothing populates it.
  Capturing each payslip's gross, PAYG withheld, super, and pre-tax deductions
  turns the tax tab from a pure projection into a running **"withheld so far vs
  estimated liability → tracking toward a $X refund/bill"** — the actual-tax-paid
  tracking the ingestion phase otherwise defers, sourced from real income numbers.
  It surfaces variance both ways: actual gross vs projected inflow, and actual
  withholding vs the estimate's implied withholding.
- **Effort.** M for manual entry; L if OCR/parsing of PDF payslips is added.
  Staged smallest-useful-first: manual entry + variance, then optional file
  attachment to a private Storage bucket, then OCR pre-fill.
- **Touches.** No external API needed for manual entry — it's a
  `Payslip`/`IncomeEvent` table (already sketched in `data-model.md`) + a small
  entry form, RLS, types, feeding the tax engine's `paygWithheldCents`. Automated
  capture (OCR of a PDF, or an email-forward parser) would need a parsing service
  and file storage (Supabase Storage) and is where the L cost lives.
- **Dependencies.** None for manual entry — it directly fills an input the tax
  engine already consumes. Independent of Up ingestion.
- **Feasibility / risks.** AU payslips are unstandardised, so reliable OCR is
  hard; start with manual entry (few fields, entered fortnightly) and treat
  parsing as a later nicety. Payslip data is sensitive → strict RLS, member
  attribution. Actual super contributions captured here also feed idea 10 (net
  worth) and 12 (salary sacrifice).

#### 3. Recurring bill / subscription detection from Up transactions

- **What / value.** Once transactions flow in, cluster them by
  merchant/amount/cadence to surface recurring commitments (utilities, insurance,
  streaming, gym) and **auto-suggest budget lines** — "we detected Netflix
  $x/mo, add to Wants?". Closes the loop between the plan and reality: the
  budget stops being hand-maintained and starts being _proposed_ from actual
  spend. Also flags price creep ("this subscription rose $4/mo") and orphaned
  subscriptions (last charge 3 months ago — cancel?).
- **Effort.** M — a detection pass (SQL/edge function over the ledger) plus a
  review-and-accept UI that writes accepted suggestions as `budget_line` rows.
- **Touches.** Backend: a recurrence-detection query/edge function; optionally a
  `detected_recurring` / suggestion table so dismissals stick. Frontend: a
  suggestions inbox on the Budget tab. No new external API (Up categories/
  merchant data come in via ingestion).
- **Dependencies.** **Ingestion** must be working (needs real transactions).
- **Feasibility / risks.** Detection heuristics are noisy — variable-amount
  bills (electricity) and annual charges need tolerance windows; keep it
  suggest-only, never auto-mutate the budget. Up's `SCHEDULED`/round-up
  transactions and internal transfers must be excluded.

#### 4. Google Calendar surfacing of money dates

- **What / value.** Push the household's financial calendar into Google Calendar
  as events: expected salary/inflow deposits, on-call pay dates (from idea 1),
  detected bill due-dates (from idea 3), savings-goal target dates, temporary-
  item expiry dates, and FY boundaries (30 Jun / 1 Jul — "new tax year, review
  configs"). Money timing shows up where the couple already look, on their
  phones, without opening the app.
- **Effort.** S–M — an edge function that writes events to a dedicated calendar;
  the source dates already exist in the data model.
- **Touches.** External API (Google Calendar) + auth. The app already uses
  Google OAuth for sign-in, but Calendar needs an _additional scope_
  (`calendar.events`) and consent — the token would live server-side (Vault) for
  an edge function to write events, or the client could write directly with an
  incremental-auth token. Mostly backend + a settings toggle; no schema change
  if events are derived on the fly.
- **Dependencies.** Base version (inflows, goals, temporary dates) works today.
  On-call and bill-due events depend on ideas 1 and 3.
- **Feasibility / risks.** Adding Calendar scope re-triggers the OAuth consent
  screen and may complicate the published-consent-screen setup noted in
  `architecture.md`. Idempotency matters — use stable event IDs so re-syncs
  update rather than duplicate. A read-only ICS feed the user subscribes to is a
  lighter-touch alternative that avoids write scopes entirely.

#### 5. CSV / multi-source bank import

- **What / value.** Both partners bank with Up today, but the import boundary is
  explicitly source-agnostic. A generic CSV importer (plus adapters for other AU
  banks) future-proofs against a joint account elsewhere, a credit card, or a
  historical backfill Up's API won't reach. Also the natural escape hatch when
  Up's API is down or rate-limited.
- **Effort.** M — a column-mapping importer + dedupe, reusing the same ledger
  and category-mapping tables Up will populate.
- **Touches.** No external API (file upload). Backend: parsing + `external_id`
  dedupe (already the ledger's dedupe key) + `CategoryMapping`. Frontend: an
  upload + column-map wizard. Supabase Storage for the uploaded file.
- **Dependencies.** Shares the ledger schema with **ingestion**; cleanest built
  alongside or just after it so both go through one import layer.
- **Feasibility / risks.** Per-bank CSV formats vary wildly; a flexible
  column-mapper beats hardcoded adapters. Dedupe across sources is the trap —
  the same transaction from two sources must not double-count (Up webhook + a
  manual CSV of the same account).

#### 6. Superannuation & brokerage balances → net worth inputs (incl. CDR super auto-fetch)

- **What / value.** Automates the asset balances behind the shipped **net worth**
  view (super fund balances, brokerage/share holdings) — replacing the manual
  balance entry / contribution-accrual the super feature uses today. Combined with
  Up `HOME_LOAN` account balances (a liability, not yet modelled) and Up
  savers/transaction balances (assets), the household gets a genuine net-worth
  figure, not just a cash-flow plan.
- **Effort.** L for live integrations; S if balances are entered manually.
- **Touches.** External APIs + auth _if_ automated — but AU super funds and most
  brokerages have **no consumer API**; realistic automated coverage means a CDR
  (Open Banking) aggregator or a service like Basiq/Frollo, which is a
  significant accreditation/cost step. Manual entry needs only an `asset` /
  `liability` table + form. Either way a schema addition for accounts that
  aren't transaction feeds.
- **Dependencies.** Net-worth _feature_ (idea 10) is the consumer of this data.
  Up `HOME_LOAN` + saver balances arrive with **ingestion**.
- **Feasibility / risks.** The automated path is the hard part — super APIs
  effectively don't exist for individuals; CDR accreditation is heavy for a
  two-person app (Up itself was chosen precisely _because_ a personal token
  needs no CDR accreditation). Super is not in CDR scope today (CDR covers
  banking and energy, with super flagged for a future designation but not yet
  designated); screen-scraping aggregators exist but are B2B and being phased
  out as CDR expands. So contribution-based accrual is the pragmatic path until
  CDR covers super, at which point the periodic manual true-up could be automated
  from each fund's real balance. Recommend manual balances first (updated
  occasionally), automating only the sources that expose a token (Up) — see idea
  10.

#### 7. ATO / MyGov tax figures

- **What / value.** Pull authoritative figures — HELP/HECS balance and annual
  indexation, PAYG withheld year-to-date, private health statement — to replace
  manually-entered `TaxProfile` inputs and keep the tax estimate honest against
  the ATO's own numbers.
- **Effort.** L (likely infeasible to automate).
- **Touches.** Would need ATO/MyGov API access + auth.
- **Dependencies.** Tax engine (built).
- **Feasibility / risks.** **Largely a non-starter for automation** — the ATO
  has no open consumer API; MyGov is not programmatically accessible to
  third parties. Realistic version: a well-designed _manual_ "update from your
  MyGov statement" flow (enter HELP balance + indexation %, YTD PAYG), plus in-
  app HELP indexation modelling (idea 11). Listed mainly to record that the
  automated version was considered and rejected.

### Native features

#### 8. Push notifications / alerts

- **What / value.** The PWA is an installed iOS home-screen app, so it can use
  Web Push. High-value, household-specific triggers: **buffer went negative**
  (a new budget line or inflow change pushed the fortnight into deficit),
  **goal ETA slipped** past its target date, **on-call/salary landed** (once
  ingestion confirms the deposit), **a temporary item is about to expire**,
  **FY boundary approaching** (review tax configs), **a bill is due / a
  detected subscription's price rose**.
- **Effort.** M — service-worker push plumbing + a trigger/evaluation layer
  (pg_cron edge function evaluating conditions and sending pushes).
- **Touches.** Web Push (VAPID keys in **Vault**); a subscriptions table
  (endpoint per device) + a notification-preferences table; edge function to
  evaluate triggers and send. Service-worker code in the PWA.
- **Dependencies.** Buffer/goal/temporary/FY alerts work on today's data.
  Deposit-landed alerts need **ingestion**.
- **Feasibility / risks.** iOS Web Push requires the PWA to be _installed_ to
  the home screen (already the primary device) and iOS 16.4+. Permission UX is
  finicky on iOS. Keep alerts few and meaningful — over-notifying kills opt-in.

#### 9. Spending insights & trends over time

- **What / value.** Once real transactions exist, chart pooled spend by category
  group over time, plan-vs-actual per group per fortnight, month-over-month
  trend, and "biggest movers". Extends the Summary donut (a snapshot) into a
  time series — the household sees whether they're actually living within the
  plan, not just what the plan says.
- **Effort.** M — reporting SQL/views + chart screens. `@mantine/charts` +
  `recharts` are already in the stack (the Summary donut uses them).
- **Touches.** Backend: reporting views (spend-vs-budget per category/period is
  already named in `architecture.md` as intended derived reporting). Frontend: a
  Trends/Insights screen or tab. No external API.
- **Dependencies.** **Ingestion** (needs actual spend to trend).
- **Feasibility / risks.** Reconciling Up categories to the six household budget
  groups needs a solid category mapping (`CategoryMapping` exists in the model).
  Watch query cost on long histories — pre-aggregate in a view.

#### 10. Net worth (assets + liabilities)

- **What / value.** The net-worth view totals assets less liabilities — account
  balances a member can see, split into Super vs Other (super balances
  auto-accruing from modelled contributions), less each member's HELP debt as a
  first liability. The remaining scope is **more liabilities** (Up `HOME_LOAN`
  balance, credit cards, other loans) and **trend over time**, so the one number
  that ties the whole household picture together also captures those debts and
  history.
- **Effort.** M for the remaining liabilities + trend work (given balances arrive
  from ingestion + manual entry per idea 6). The HELP-debt liability is a shipped
  down-payment on this.
- **Touches.** Schema: an `asset`/`liability` model (or generalise the existing
  `Account` model, which already has `type` including `credit`/`offset` and a
  nullable `owner_member_id` for joint) + periodic balance snapshots for a
  trend. Frontend: a net-worth screen. External APIs only via idea 6.
- **Dependencies.** Balance sources — Up (**ingestion**) for savers/home-loan;
  manual or aggregator (idea 6) for super/brokerage.
- **Feasibility / risks.** Up's `HOME_LOAN` account type exposes a balance, so
  the mortgage liability is genuinely automatable via the existing Up token —
  the most valuable near-term slice. Snapshotting balances over time needs a
  scheduled job. Valuation of illiquid assets (property) stays manual.

#### 11. HELP/HECS indexation & repayment refinements

- **What / value.** The tax engine already models marginal HELP repayment. Add
  **annual indexation** (HELP debt grows by an indexation rate each 1 June) so
  the projected debt balance and repayment are right across multiple years, and
  optionally show "debt paid off in FY20XX". Very relevant given the marginal
  HELP model is already a first-class part of the tax config.
- **Effort.** S — extend `TaxYearConfig` with an indexation rate and add a
  multi-year projection in the pure `@nest/tax` package.
- **Touches.** Config + pure package math only — no external API, no schema
  change beyond a config field. Frontend: surface the multi-year payoff on the
  Tax tab.
- **Dependencies.** None — pure extension of shipped tax code.
- **Feasibility / risks.** Indexation rate is published by the ATO annually and
  fits the existing "versioned config, never hardcoded" convention. Timing
  subtlety: indexation applies to the balance _before_ the year's compulsory
  repayment is credited — order of operations must match the ATO's.

#### 12. Salary sacrifice & super optimisation

- **What / value.** Show the take-home vs tax trade-off of pre-tax super
  contributions: "sacrifice $X → save $Y in tax, take-home drops $Z". The
  underlying modelling — salary sacrifice / personal deductible reducing taxable
  income, 15% contributions tax, Division 293, and the concessional cap — is
  shipped (see Done: Superannuation & net worth); the remainder is a what-if
  comparison panel on the Tax tab. Directly relevant to a dual-income AU
  household optimising tax.
- **Effort.** M — a small "what-if" comparison on the Tax tab over the existing
  tax inputs.
- **Touches.** Tax engine input + `TaxProfile`/`Payslip` fields; pure package
  math; a frontend what-if panel. No external API.
- **Dependencies.** Builds on the tax engine (done); richer with payslip
  ingestion (idea 2).
- **Feasibility / risks.** Must respect the concessional contributions cap and
  the 15% contributions tax to compute the real benefit — otherwise the "tax
  saved" figure overstates. Div 293 for high earners is an edge case worth
  flagging in the comparison.

#### 13. Medicare levy surcharge tiers & private-health what-if

- **What / value.** The config already sketches MLS `tiers`. Add a what-if:
  "without private hospital cover, your combined-income MLS tier is X% = $Y/yr —
  compare to a $Z/yr policy premium" so the household can decide whether hospital
  cover actually pays for itself. AU-specific, couple-specific (MLS uses combined
  family income above the family threshold), and genuinely actionable.
- **Effort.** S–M — the surcharge computation exists; add the family-income
  threshold logic and a comparison UI.
- **Touches.** Tax engine + config (family thresholds); pure package; a Tax-tab
  panel. No external API.
- **Dependencies.** Tax engine (done). The `has_private_health` flag already
  exists on `TaxProfile`.
- **Feasibility / risks.** MLS for a couple is tested on _combined_ family
  income against a family threshold (raised per dependent child) — different
  from the per-person assessment the rest of the engine uses; needs a
  household-level pass over both members. Also interacts with the private-health
  rebate (income-tested), which could be modelled together.

#### 14. Inflow → budget-category netting

- **What / value.** Already named as a deferred enhancement in the Product
  decisions above and in `budget-and-savings.md`: assign a non-taxable inflow
  (e.g. a capped work reimbursement) to a specific budget category so it nets
  against that spend rather than just inflating the buffer. Makes the
  reimbursement-heavy parts of the plan read truthfully.
- **Effort.** S — a nullable `category`/`budget_line` link on inflow + summary
  math that nets it.
- **Touches.** Schema (one nullable FK on inflow) + `@nest/plan` summary math
  + a small UI control. No external API.
- **Dependencies.** None — pure extension of the shipped plan-only app.
- **Feasibility / risks.** Low risk; mostly a summary-presentation decision
  (does a netted inflow reduce the group's outgoing, or sit as a credit line?).
  Keep the donut still reconciling to the same buffer.

#### 15. Up Saver ↔ temporary-item linking

- **What / value.** Linking a **Savings goal** to an Up `SAVER` account so its
  real balance drives progress/ETA is shipped (see Done: Up savers → savings
  goals). The unshipped remainder is the same for **Temporary items** — link a
  Temporary item to a saver so its real balance populates `current_cents` instead
  of manual entry. `budget-and-savings.md` lists this as deferred.
- **Effort.** S–M — reuse the goal's `linked_account_id` pattern for temporary
  items + pull the balance.
- **Touches.** Up API (via **ingestion**; token in Vault). Schema: a
  `linked_account_id` on the temporary item (goals already carry one). Frontend:
  a link picker + "real vs planned" display.
- **Dependencies.** Up account/balance sync — already satisfied for savers by the
  shipped `up-sync`.
- **Feasibility / risks.** Up exposes `SAVER` balances cleanly. **Maybuy is not
  in the Up API** (no account type/resource; transactions can leak per
  `up-banking/api#148`) — so Maybuy-backed temporary items stay manual or track
  via the underlying saver. Multiple savers → one item (and vice versa) needs a
  clear mapping rule.

#### 16. Savings interest modelling

- **What / value.** Up savers earn bonus interest (subject to conditions). Model
  the interest rate in goal projections so ETA reflects compounding, not just
  linear `current + contribution × fortnights`. Also: interest is assessable
  income — a projected-interest figure could feed the tax estimate's investment
  income. Small but makes long-horizon goals materially more accurate.
- **Effort.** S — extend the goal projection in `@nest/plan` with a rate.
- **Touches.** Pure package math + a rate field on the goal; a UI input. No
  external API for the projection (the rate is user-entered; Up doesn't publish
  a clean per-account rate resource).
- **Dependencies.** None for projection; interest-as-income ties into the tax
  engine.
- **Feasibility / risks.** Up's bonus interest is conditional (min deposit, no
  withdrawals) — model a simple effective annual rate rather than the full
  bonus-condition logic. Fortnightly compounding is easy given the existing
  fortnight-normalised math.

#### 17. Data export & backup (CSV / spreadsheet)

- **What / value.** The app _replaced_ the household's spreadsheet — an export
  back to CSV/Sheets gives them an escape hatch, a paper trail, and a way to do
  ad-hoc analysis the app doesn't offer. Also a cheap disaster-recovery comfort.
- **Effort.** S — client-side CSV generation from data already loaded, or an
  edge function for a full dump.
- **Touches.** Frontend-only for the simple version (generate CSV in-browser);
  no external API, no schema change. A Google Sheets push would need Sheets API
  scope (like idea 4).
- **Dependencies.** None.
- **Feasibility / risks.** Trivial and low-risk; the only care is not leaking
  another household's data (RLS already scopes reads).

#### 18. Multi-year / scenario planning

- **What / value.** A "what-if" layer over the plan: model a pay rise, a new
  recurring bill, a mortgage rate change, or a partner going part-time, and see
  the effect on tax, buffer, and goal ETAs before committing it to the live
  plan. The household's real financial decisions (should we take on X?) become
  answerable in-app.
- **Effort.** L — needs a scenario/overlay concept distinct from the single
  living plan.
- **Touches.** Schema (scenario overlays or a duplicated draft plan) +
  `@nest/plan` and `@nest/tax` re-run over scenario inputs. Frontend: a
  scenario switcher. No external API — the compute engines are already pure and
  I/O-free, which makes re-running them on hypothetical inputs cheap.
- **Dependencies.** None technically, but higher value once there's actual data
  to anchor the baseline (ingestion).
- **Feasibility / risks.** Main risk is UX/scope creep — the app is deliberately
  a _single living plan_ with no per-period versioning. A lightweight
  "sandbox mode" that never persists may capture most of the value without a
  heavy scenario schema.

### My top picks

Ranked for value-to-effort against this specific household's setup:

1. **Up Saver ↔ temporary-item linking (15)** — the Savings-goal half shipped;
   the remaining slice extends the same real-balance linking to Temporary items.
   Small, high roadmap alignment, and the saver balances it needs are already
   synced.
2. **incident.io on-call pay forecasting (1)** — solves a real modelling gap
   (the `every_n_weeks` proxy) with a concrete dated forecast; distinctive and
   directly useful to this user. Provider-abstract it (PagerDuty/Opsgenie).
3. **Payslip / PAYG manual entry (2)** — unlocks actual-tax-paid tracking with
   _no_ external dependency, filling an input the tax engine already consumes.
4. **HELP indexation + salary-sacrifice/MLS tax refinements (11, 12, 13)** —
   cheap, pure-package extensions of already-shipped tax code with high dollar
   relevance to a dual-income AU household with HELP debt.
5. **Push notifications (8)** — makes the installed PWA proactive (negative
   buffer, goal slippage, deposit landed); most of its triggers work on today's
   data, the rest arrive with ingestion.

Honourable mentions: **net worth via the Up `HOME_LOAN` balance (10)** is a
big-picture win that's genuinely automatable through the existing Up token, and
**inflow→category netting (14)** is a tiny, already-deferred change that makes
reimbursements read truthfully.
