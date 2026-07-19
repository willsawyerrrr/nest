# Roadmap

Phased so each phase is independently useful. The plan-only app (income, tax,
budget, savings goals) is built and deployed — it fully replaces the household's
spreadsheet and needs no transaction data. Up ingestion is the current phase, to
reconcile the plan against reality.

## Product decisions

- **Single shared household; money fully pooled.** No per-person budgets, no
  splitting, no "who owes whom".
- **All household members manage everything** — RLS is gated on household
  membership only; member attribution on a record is a tax/reporting tag, not a
  permission.
- **Money-in is modelled as inflows.** The household owns many projection-based
  inflows, each on a schedule, split by taxability:
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
- CI split into parallel `check` / `test` / `rls` jobs (under a minute).
- Household, members, and RLS isolation (schema + automated CI tests).
- Onboarding + first-run gating; Google OAuth; partner join via invite code.
- Ledger schema: accounts, transactions, categories (schema only).

### Plan-only app (complete — replaces the household's spreadsheet)

- Income + tax-profile schema.
- Verified FY2027 tax config + marginal HELP model; the pure `@budget/tax`
  engine (`configsByYear`).
- Inflows model: taxable / non-taxable split, member-tagged taxable income,
  quarterly and biannual schedules; only taxable inflows feed the tax estimate.
- Income + tax-estimate UI: inflow management and the tax view (per-person
  breakdown + household take-home, annual and fortnightly).
- Budget, savings-goal, and temporary-item schema (RLS, tests, types).
- `@budget/plan` pure math package: schedule normalization, summary
  reconciliation, goal projection, temporary expiry.
- Budget UI: grouped-line CRUD (Needs / Wants / Discretionary / Temporary /
  Savings / Investments), each line amount + frequency normalised to a fortnight.
- Summary / reconciliation UI: after-tax income + non-taxable inflows − outgoings
  − savings block = remaining buffer, with each group's fortnightly / annual /
  portion.
- Goals UI: target amounts and dates, manual current balance, projected progress
  + ETA; Savings lines linked to a goal.
- Mantine mobile-first restyle; two-decimal money formatting.
- Navigation: Summary is the landing tab; order Summary · Inflows · Budget ·
  Goals · Tax · Household.
- Up Bank sync scaffold (not yet functional).

## Now — Up ingestion + reconciliation

- [ ] Per-member Up token in Vault; webhook + scheduled poll; dedupe on
      `external_id`.
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget, and real balances against
      savings goals.
- [ ] Track actual tax paid (PAYG withheld) for a refund/bill vs the estimate.

## Later still

- Reconcile projected income against actual deposits; joint-income ownership
  split; net worth (assets and liabilities); recurring bills and forecasting;
  non-resident and part-year tax; notifications; additional bank sources / CSV.
