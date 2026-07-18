# Roadmap

Phased so each phase is independently useful. The entire plan-only app (income,
tax, budget, savings goals) is built first and needs no transaction data — it
replaces the household's spreadsheet. Up ingestion comes later, to reconcile the
plan against reality.

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
  financial year: FY2027. Tracking actual tax paid is deferred.
- **Budgeting is plan-only and fortnightly.** The household allocates projected
  after-tax income across grouped categories — Needs, Wants, Discretionary,
  Temporary, Savings, Investments — each line an amount + frequency normalised to
  a fortnight, with a live remaining buffer (granular, not strictly zero-based).
  Needs = regular essentials; Wants = regular quality-of-life; Discretionary =
  non-regular discretionary purchases; Temporary = short-term/one-off items that
  expire.
- **Ingestion is a later enhancement.** Both partners bank with Up; pulling
  actual transactions is only needed to reconcile spend and goal progress against
  the plan, so it comes after the plan-only app.

## Done

- Foundations: stack, monorepo scaffold, CI (`check` + `rls`, under a minute),
  `main` protection ruleset, Vercel hosting.
- Household, members, and RLS isolation (schema + automated CI tests).
- Onboarding + Google OAuth; partner join via invite code (live in production).
- Ledger schema: accounts, transactions, categories (schema only).
- Income + tax-profile schema.
- Verified FY2027 tax config + marginal HELP model; pure tax engine.
- Inflows model: taxable / non-taxable split, member-tagged taxable income,
  quarterly and biannual schedules; only taxable inflows feed the tax estimate.
- Income + tax-estimate UI: inflow management and the tax view (per-person
  breakdown + household take-home, annual and fortnightly).
- Budget, savings-goal, and temporary-item schema (RLS, tests, types).
- `@budget/plan` pure math package: schedule normalization, summary
  reconciliation, goal projection, temporary expiry.
- Mantine mobile-first restyle.
- Up Bank sync scaffold (not yet functional).

## Now — Budget (plan-only)

The income + tax-estimate slice is complete; the budget schema and `@budget/plan`
math are done, and the Budget UI is in progress. This finishes the outgoings side
of the plan.

- [ ] Budget CRUD UI: grouped-line management (Needs / Wants / Discretionary /
      Temporary / Savings / Investments), each line amount + frequency normalised
      to a fortnight.

## Next — Summary + reconciliation (plan-only)

- [ ] Summary UI: after-tax income + non-taxable inflows − outgoings − savings
      block = remaining buffer, with each group's fortnightly / annual / portion.

## Then — Savings goals

- [ ] Goals UI: target amounts and dates, manual current balance, projected
      progress + ETA; link Savings lines to a goal.
- [ ] Temporary items: date-driven fortnightly outflows that expire at a target
      date.

## Later — Up ingestion + reconciliation

- [ ] Per-member Up token in Vault; webhook + scheduled poll; dedupe on
      `external_id`.
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget, and goal progress against
      balances.
- [ ] Track actual tax paid (PAYG withheld) for a refund/bill vs estimate.

## Later still

- Reconcile projected income against actual deposits; joint-income ownership
  split; net worth (assets and liabilities); recurring bills and forecasting;
  non-resident and part-year tax; notifications; additional bank sources / CSV.
