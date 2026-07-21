# Future ideas

A brainstorm of integrations and native features that would extend this app
beyond its current plan-only + Up-ingestion scope. Ideas only — nothing here is
committed. Each entry notes user value, rough effort (S/M/L), what it touches
(external API + where the secret lives / schema-or-backend change /
frontend-only), dependencies, and feasibility notes. Skim the headings, then see
**My top picks** at the end.

Recurring shorthand:

- **Vault** = a secret stored in Supabase Vault, fetched only by an edge
  function — the exact pattern already specced for Up personal-access tokens.
- **Ingestion** = the "Up ingestion + reconciliation" phase in `ROADMAP.md`
  (per-member Up token, webhook + scheduled poll, dedupe on `external_id`,
  transactions mapped into the shared ledger). Several ideas are blocked on it.
- Money is always integer cents; every domain row carries `household_id` for
  RLS.

---

## Integrations

### 1. incident.io on-call schedule → on-call pay forecasting

- **What / value.** The user's on-call payment is currently modelled as an
  `every_n_weeks` inflow with N ≈ the team rotation size — a rough proxy that
  drifts as soon as a shift is swapped, a public holiday shifts a rotation, or
  the roster changes. Integrating incident.io's schedules/on-call API reads the
  *actual* rotation, so the app can show a concrete **"next on-call payment:
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
  Real modelling risk is the *pay* side, not the *roster* side: on-call
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

### 2. Payslip / PAYG ingestion (actual withheld vs the estimate)

- **What / value.** The tax engine already has a slot for `paye_withheld_cents`
  and computes a balance (owing vs refund) against it, but nothing populates it.
  Capturing each payslip's gross, PAYG withheld, super, and pre-tax deductions
  turns the tax tab from a pure projection into a running **"withheld so far vs
  estimated liability → tracking toward a $X refund/bill"** — exactly the
  actual-tax-paid tracking `ROADMAP.md` defers to the ingestion phase.
- **Effort.** M for manual entry; L if OCR/parsing of PDF payslips is added.
- **Touches.** No external API needed for manual entry — it's a
  `Payslip`/`IncomeEvent` table (already sketched in `DATA_MODEL.md`) + a small
  entry form, RLS, types. Automated capture (OCR of a PDF, or an email-forward
  parser) would need a parsing service and file storage (Supabase Storage) and
  is where the L cost lives.
- **Dependencies.** None for manual entry — it directly fills an input the tax
  engine already consumes. Independent of Up ingestion.
- **Feasibility / risks.** AU payslips are unstandardised, so reliable OCR is
  hard; start with manual entry (few fields, entered fortnightly) and treat
  parsing as a later nicety. Payslip data is sensitive → strict RLS, member
  attribution. Actual super contributions captured here also feed idea 10 (net
  worth) and 12 (salary sacrifice).

### 3. Recurring bill / subscription detection from Up transactions

- **What / value.** Once transactions flow in, cluster them by
  merchant/amount/cadence to surface recurring commitments (utilities, insurance,
  streaming, gym) and **auto-suggest budget lines** — "we detected Netflix
  $x/mo, add to Wants?". Closes the loop between the plan and reality: the
  budget stops being hand-maintained and starts being *proposed* from actual
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

### 4. Google Calendar surfacing of money dates

- **What / value.** Push the household's financial calendar into Google Calendar
  as events: expected salary/inflow deposits, on-call pay dates (from idea 1),
  detected bill due-dates (from idea 3), savings-goal target dates, temporary-
  item expiry dates, and FY boundaries (30 Jun / 1 Jul — "new tax year, review
  configs"). Money timing shows up where the couple already look, on their
  phones, without opening the app.
- **Effort.** S–M — an edge function that writes events to a dedicated calendar;
  the source dates already exist in the data model.
- **Touches.** External API (Google Calendar) + auth. The app already uses
  Google OAuth for sign-in, but Calendar needs an *additional scope*
  (`calendar.events`) and consent — the token would live server-side (Vault) for
  an edge function to write events, or the client could write directly with an
  incremental-auth token. Mostly backend + a settings toggle; no schema change
  if events are derived on the fly.
- **Dependencies.** Base version (inflows, goals, temporary dates) works today.
  On-call and bill-due events depend on ideas 1 and 3.
- **Feasibility / risks.** Adding Calendar scope re-triggers the OAuth consent
  screen and may complicate the published-consent-screen setup noted in
  `ARCHITECTURE.md`. Idempotency matters — use stable event IDs so re-syncs
  update rather than duplicate. A read-only ICS feed the user subscribes to is a
  lighter-touch alternative that avoids write scopes entirely.

### 5. CSV / multi-source bank import

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

### 6. Superannuation & brokerage balances → net worth inputs

- **What / value.** Automates the asset balances behind the shipped **net worth**
  view (super fund balances, brokerage/share holdings) — replacing the manual
  balance entry / contribution-accrual the super feature uses today. Combined with
  Up `HOME_LOAN` account balances (a liability, not yet modelled) and Up
  savers/transaction balances (assets), the household gets a genuine net-worth
  figure, not just a cash-flow plan. Super auto-fetch specifically is tracked as
  the CDR item in `ROADMAP.md`.
- **Effort.** L for live integrations; S if balances are entered manually.
- **Touches.** External APIs + auth *if* automated — but AU super funds and most
  brokerages have **no consumer API**; realistic automated coverage means a CDR
  (Open Banking) aggregator or a service like Basiq/Frollo, which is a
  significant accreditation/cost step. Manual entry needs only an `asset` /
  `liability` table + form. Either way a schema addition for accounts that
  aren't transaction feeds.
- **Dependencies.** Net-worth *feature* (idea 10) is the consumer of this data.
  Up `HOME_LOAN` + saver balances arrive with **ingestion**.
- **Feasibility / risks.** The automated path is the hard part — super APIs
  effectively don't exist for individuals; CDR accreditation is heavy for a
  two-person app (Up itself was chosen precisely *because* a personal token
  needs no CDR accreditation). Recommend manual balances first (updated
  occasionally), automate only the sources that expose a token (Up) — see idea
  10.

### 7. ATO / MyGov tax figures

- **What / value.** Pull authoritative figures — HELP/HECS balance and annual
  indexation, PAYG withheld year-to-date, private health statement — to replace
  manually-entered `TaxProfile` inputs and keep the tax estimate honest against
  the ATO's own numbers.
- **Effort.** L (likely infeasible to automate).
- **Touches.** Would need ATO/MyGov API access + auth.
- **Dependencies.** Tax engine (built).
- **Feasibility / risks.** **Largely a non-starter for automation** — the ATO
  has no open consumer API; MyGov is not programmatically accessible to
  third parties. Realistic version: a well-designed *manual* "update from your
  MyGov statement" flow (enter HELP balance + indexation %, YTD PAYG), plus in-
  app HELP indexation modelling (idea 11). Listed mainly to record that the
  automated version was considered and rejected.

---

## Native features

### 8. Push notifications / alerts

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
- **Feasibility / risks.** iOS Web Push requires the PWA to be *installed* to
  the home screen (already the primary device) and iOS 16.4+. Permission UX is
  finicky on iOS. Keep alerts few and meaningful — over-notifying kills opt-in.

### 9. Spending insights & trends over time

- **What / value.** Once real transactions exist, chart pooled spend by category
  group over time, plan-vs-actual per group per fortnight, month-over-month
  trend, and "biggest movers". Extends the Summary donut (a snapshot) into a
  time series — the household sees whether they're actually living within the
  plan, not just what the plan says.
- **Effort.** M — reporting SQL/views + chart screens. `@mantine/charts` +
  `recharts` are already in the stack (the Summary donut uses them).
- **Touches.** Backend: reporting views (spend-vs-budget per category/period is
  already named in `ARCHITECTURE.md` as intended derived reporting). Frontend: a
  Trends/Insights screen or tab. No external API.
- **Dependencies.** **Ingestion** (needs actual spend to trend).
- **Feasibility / risks.** Reconciling Up categories to the six household budget
  groups needs a solid category mapping (`CategoryMapping` exists in the model).
  Watch query cost on long histories — pre-aggregate in a view.

### 10. Net worth (assets + liabilities)

- **What / value.** A first-cut net-worth view is shipped — it totals the account
  balances a member can see (assets only), split into Super vs Other, with super
  balances auto-accruing from modelled contributions. The remaining scope is **liabilities**
  (Up `HOME_LOAN` balance, credit cards, other loans) and **trend over time**, so
  the one number that ties the whole household picture together also captures debt
  and history, not just current assets.
- **Effort.** M for the remaining liabilities + trend work (given balances arrive
  from ingestion + manual entry per idea 6).
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

### 11. HELP/HECS indexation & repayment refinements

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
  subtlety: indexation applies to the balance *before* the year's compulsory
  repayment is credited — order of operations must match the ATO's.

### 12. Salary sacrifice & super optimisation

- **What / value.** Model pre-tax super contributions (salary sacrifice /
  personal deductible) and show the take-home vs tax trade-off: "sacrifice $X →
  save $Y in tax, take-home drops $Z". The config already carries
  `super_guarantee_rate`, and `Payslip` already sketches `super_cents` and
  `pre_tax_deductions_cents`, so the inputs are half-modelled. Directly relevant
  to a dual-income AU household optimising tax.
- **Effort.** M — extend the tax inputs (pre-tax deduction reduces assessable
  income) and add a small "what-if" comparison on the Tax tab.
- **Touches.** Tax engine input + `TaxProfile`/`Payslip` fields; pure package
  math; a frontend what-if panel. No external API.
- **Dependencies.** Builds on the tax engine (done); richer with payslip
  ingestion (idea 2).
- **Feasibility / risks.** Must respect the concessional contributions cap
  ($30k for FY2025+) and the 15% contributions tax to compute the real benefit —
  otherwise the "tax saved" figure overstates. Div 293 for high earners is an
  edge case worth flagging but not necessarily modelling first.

### 13. Medicare levy surcharge tiers & private-health what-if

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
- **Feasibility / risks.** MLS for a couple is tested on *combined* family
  income against a family threshold (raised per dependent child) — different
  from the per-person assessment the rest of the engine uses; needs a
  household-level pass over both members. Also interacts with the private-health
  rebate (income-tested), which could be modelled together.

### 14. Inflow → budget-category netting

- **What / value.** Already named as a deferred enhancement in `ROADMAP.md` and
  `budget-and-savings.md`: assign a non-taxable inflow (e.g. a capped work
  reimbursement) to a specific budget category so it nets against that spend
  rather than just inflating the buffer. Makes the reimbursement-heavy parts of
  the plan read truthfully.
- **Effort.** S — a nullable `category`/`budget_line` link on inflow + summary
  math that nets it.
- **Touches.** Schema (one nullable FK on inflow) + `@nest/plan` summary math
  + a small UI control. No external API.
- **Dependencies.** None — pure extension of the shipped plan-only app.
- **Feasibility / risks.** Low risk; mostly a summary-presentation decision
  (does a netted inflow reduce the group's outgoing, or sit as a credit line?).
  Keep the donut still reconciling to the same buffer.

### 15. Up Saver ↔ goal/temporary-item linking

- **What / value.** `budget-and-savings.md` already specs this as the near-term
  Up focus: link a Savings goal or Temporary item to an Up `SAVER` account so
  its **real balance** populates `current_cents` instead of manual entry, and
  goal progress/ETA reconcile against reality. The single most roadmap-aligned
  idea here.
- **Effort.** M — map Up saver accounts to goals/items + pull balances.
- **Touches.** Up API (via **ingestion**; token in Vault). Schema: a
  `linked_account_id` on goal/temporary item (already present on `SavingsGoal`
  in `DATA_MODEL.md`). Frontend: a link picker + "real vs planned" display.
- **Dependencies.** **Ingestion** (Up accounts + balances).
- **Feasibility / risks.** Up exposes `SAVER` balances cleanly. **Maybuy is not
  in the Up API** (no account type/resource; transactions can leak per
  `up-banking/api#148`) — so Maybuy-backed temporary items stay manual or track
  via the underlying saver. Multiple savers → one goal (and vice versa) needs a
  clear mapping rule.

### 16. Savings interest modelling

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

### 17. Data export & backup (CSV / spreadsheet)

- **What / value.** The app *replaced* the household's spreadsheet — an export
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

### 18. Multi-year / scenario planning

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
  a *single living plan* with no per-period versioning. A lightweight
  "sandbox mode" that never persists may capture most of the value without a
  heavy scenario schema.

---

## My top picks

Ranked for value-to-effort against this specific household's setup:

1. **Up Saver ↔ goal/temporary linking (15)** — highest roadmap alignment;
   turns manual balances into real ones and is the stated near-term Up focus.
   Lands naturally as part of ingestion.
2. **incident.io on-call pay forecasting (1)** — solves a real modelling gap
   (the `every_n_weeks` proxy) with a concrete dated forecast; distinctive and
   directly useful to this user. Provider-abstract it (PagerDuty/Opsgenie).
3. **Payslip / PAYG manual entry (2)** — unlocks actual-tax-paid tracking with
   *no* external dependency, filling an input the tax engine already consumes.
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
