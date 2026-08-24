# Roadmap & ideas

The single backlog for this project — there are no GitHub issues, so everything
lives here. It covers only uncommitted work: **Later**, then the **Ideas
backlog**, a ranked wish-list of varying likelihood. All future work is phased
so each phase is independently useful.

## Product decisions

The locked product/scope decisions are canonical in
[`CLAUDE.md`](../CLAUDE.md#fixed-scope-decisions) — single shared household with
money fully pooled, projection-based inflows split by taxability, estimate-only
AU tax, full super modelling, a plan-only fortnightly budget, and Up ingestion as
the reconciliation layer. This roadmap phases the delivery of those decisions; it
does not restate them.

## Later

Uncommitted work, roughly ordered by likelihood of being picked up.

- **Spreadsheet-parity gaps** ([`spreadsheet-parity.md`](spreadsheet-parity.md)):
  a wishlist of per-member aspirational purchases. Small and low-risk; good HDD
  filler. (Generic itemised sub-budgets are built as breakdowns; gift budgets are a
  separate standalone roll-up.)
- Reconcile projected income against actual deposits; joint-income ownership
  split; recurring bills and forecasting; non-resident and part-year tax.

### Up ledger + reconciliation

A large, deprioritised phase that pulls Up transactions across every category to
reconcile spend and tax against the plan; the gift-category slice of the sync
foundation is already ingested. See
[`up-ledger-sync.md`](up-ledger-sync.md) for the full design (staged sync
foundation, ledger UI, and the two reconciliation layers).

- [ ] Transaction sync across every category: webhook + scheduled poll; dedupe on
      `external_id` (the account pass and the gift-category poll are done).
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget.
- [ ] Track actual tax paid (PAYG withheld) for a refund/bill vs the estimate from
      the spend/transfer side; the income side is covered by payslips.

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
  as events: expected salary/inflow deposits, detected bill due-dates (from idea
  3), savings-goal target dates, temporary-item expiry dates, and FY boundaries
  (30 Jun / 1 Jul — "new tax year, review configs"). Money timing shows up where
  the couple already look, on their phones, without opening the app.
- **Effort.** S–M — an edge function that writes events to a dedicated calendar;
  the source dates already exist in the data model.
- **Touches.** External API (Google Calendar) + auth. The app already uses
  Google OAuth for sign-in, but Calendar needs an _additional scope_
  (`calendar.events`) and consent — the token would live server-side (Vault) for
  an edge function to write events, or the client could write directly with an
  incremental-auth token. Mostly backend + a settings toggle; no schema change
  if events are derived on the fly.
- **Dependencies.** Base version (inflows, goals, temporary dates) works today.
  Bill-due events depend on idea 3.
- **Feasibility / risks.** Adding Calendar scope re-triggers the OAuth consent
  screen and may complicate the published-consent-screen setup noted in
  `architecture.md`. Idempotency matters — use stable event IDs so re-syncs
  update rather than duplicate. A read-only ICS feed the user subscribes to is a
  lighter-touch alternative that avoids write scopes entirely.

#### 5. CSV / multi-source bank import

- **What / value.** Both partners bank with Up today, but the import boundary is
  explicitly source-agnostic. A structured multi-bank source (plus a CSV
  fallback for banks it doesn't reach) future-proofs against a joint account
  elsewhere, a credit card, or a historical backfill Up's API won't reach. Also
  the natural escape hatch when Up's API is down or rate-limited.
- **Effort.** M — either a column-mapping CSV importer + dedupe, or a
  Redbark-backed sync reusing the ledger dedupe pattern (see
  [`redbark-ingestion.md`](redbark-ingestion.md)).
- **Touches.** CSV path: no external API (file upload), parsing + `external_id`
  dedupe + `CategoryMapping`, an upload + column-map wizard, Supabase Storage
  for the uploaded file. Redbark path: an external API + Vault credential,
  mirroring the Up connect/sync edge functions.
- **Dependencies.** Shares the ledger schema with **ingestion**; cleanest built
  alongside or just after it so both go through one import layer.
- **Feasibility / risks.** Per-bank CSV formats vary wildly; a flexible
  column-mapper beats hardcoded adapters, and dedupe across sources is the
  trap — the same transaction from two sources must not double-count (Up
  webhook + a manual CSV of the same account). Redbark sidesteps per-bank CSV
  parsing entirely by returning structured data over CDR for 100+ AU/NZ banks,
  at the cost of a recurring subscription and an unconfirmed multi-person
  connection model — see [`redbark-ingestion.md`](redbark-ingestion.md) for the
  detailed design and open questions.

#### 6. Superannuation & brokerage balances → net worth inputs (incl. CDR super auto-fetch)

- **What / value.** Automates the asset balances behind the shipped **net worth**
  view (super fund balances, brokerage/share holdings) — replacing the manual
  balance entry / contribution-accrual the super feature uses today. Startup
  equity grants already ship on the Equity tab as a manual asset: their vested
  value (options at their gain over the strike, shares at a user-maintained price
  per share) feeds net worth, with no Cake or cap-table API involved. Combined
  with
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
- **Feasibility / risks.** Super itself is the hard part — super APIs
  effectively don't exist for individuals, and super is not in CDR scope today
  (CDR covers banking and energy, with super flagged for a future designation
  but not yet designated); screen-scraping aggregators exist but are B2B and
  being phased out as CDR expands. So contribution-based accrual is the
  pragmatic path until CDR covers super, at which point the periodic manual
  true-up could be automated from each fund's real balance. Brokerage and bank
  balances are a different story: a developer-facing CDR aggregator such as
  [Redbark](redbark-ingestion.md) removes the accreditation cost this app
  would otherwise carry directly — see `redbark-ingestion.md` for the design
  sketch and its open questions (chiefly whether one subscription covers two
  household members' separate bank connections). Recommend manual balances for
  super regardless, automating brokerage/bank balances via Up (idea 10) and,
  once a real need exists, Redbark for anything Up doesn't reach.

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
  MyGov statement" flow (enter HELP balance + indexation %, YTD PAYG), feeding
  the shipped in-app HELP indexation and payoff modelling. Listed mainly to record
  that the automated version was considered and rejected.

### Native features

#### 8. Push notifications / alerts

- **What / value.** The PWA is an installed iOS home-screen app, so it can use
  Web Push. The **delivery half is shipped**: a member opts each device in, the
  subscription lands in `push_subscription` (own-member-only RLS), the VAPID
  keypair lives in Vault, and `push-key` / `push-test` serve the application
  server key and fire a verifiable test notification — see
  [`architecture.md`](architecture.md#push-notifications). What remains is
  everything that decides **when** to notify: the high-value,
  household-specific triggers are **buffer went negative**
  (a new budget line or inflow change pushed the fortnight into deficit),
  **goal ETA slipped** past its target date, **on-call/salary landed** (once
  ingestion confirms the deposit), **a temporary item is about to expire**,
  **FY boundary approaching** (review tax configs), **a bill is due / a
  detected subscription's price rose**.
- **Effort.** S–M for the remainder — a pg_cron-driven edge function evaluating
  the conditions over existing data and reusing the shipped send path, plus
  per-trigger preferences.
- **Touches.** Schema: a notification-preferences table (which triggers a member
  wants) and whatever dedupe state stops one condition pushing every run. A new
  edge function to evaluate and send, scheduled the way `up-sync-hourly` is. No
  new Vault secrets and no client push plumbing — both are in place.
- **Dependencies.** Buffer/goal/temporary/FY alerts work on today's data.
  Deposit-landed alerts need **ingestion**.
- **Feasibility / risks.** iOS Web Push requires the PWA to be _installed_ to
  the home screen (already the primary device) and iOS 16.4+. Permission UX is
  finicky on iOS. Keep alerts few and meaningful — over-notifying kills opt-in,
  and an installed PWA has no second chance once permission is denied.

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
  auto-accruing from modelled contributions), plus the vested value of each
  startup-equity grant, less each member's HELP debt as a first liability. The
  remaining scope is **more liabilities** (Up `HOME_LOAN` balance, credit cards,
  other loans) and **trend over time**, so the one number that ties the whole
  household picture together also captures those debts and history.
- **Effort.** M for the remaining liabilities + trend work (given balances arrive
  from ingestion + manual entry per idea 6). The HELP-debt liability and the
  vested-equity asset are shipped down-payments on this.
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
  real balance drives progress/ETA is shipped. The unshipped remainder is the
  same for **Temporary items** — link a
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
2. **Push notification triggers (8)** — the subscription store, VAPID keys, and
   send path are shipped (a device can opt in and receive a test push), so what is
   left is the evaluation layer that makes the installed PWA proactive (negative
   buffer, goal slippage, deposit landed); most of those triggers work on today's
   data, the rest arrive with ingestion.

Honourable mentions: **net worth via the Up `HOME_LOAN` balance (10)** is a
big-picture win that's genuinely automatable through the existing Up token, and
**inflow→category netting (14)** is a tiny, already-deferred change that makes
reimbursements read truthfully.
