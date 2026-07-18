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
- **Income is projection-based.** The household owns many incomes, each a salary
  (annual gross), a wage (rate × standard hours), or other regular income, on a
  schedule, and each tagged to a member for tax. Projections, not reconciled
  against actual deposits.
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
- Up Bank sync scaffold (not yet functional).

## Now — Income + tax estimate

- [x] `income` + `tax_profile` schema (RLS, tests, types).
- [x] Verified FY2027 tax config (real ATO figures) + marginal HELP model.
- [ ] Tax computation: annualize incomes → per-person + household estimate.
- [ ] Income management UI.
- [ ] Tax-estimate view (per-person breakdown + household take-home, annual and
      fortnightly).

## Next — Budget + summary (plan-only)

- [ ] Extend the schedule enum with quarterly and biannual.
- [ ] Budget model: grouped categories with amount + frequency per line,
      normalised to fortnightly.
- [ ] Summary reconciliation: after-tax income − outgoings − savings = remaining
      buffer, with each group's fortnightly / annual / portion.

## Then — Savings goals

- [ ] Goals with target amounts and dates.
- [ ] Fortnightly contributions linked to goals; Temporary items with expiry.

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
