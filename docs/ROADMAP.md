# Roadmap

Phased so each phase is independently useful. Reflects the product decisions
below; income + tax is built first because it needs no transaction data.

## Product decisions

- **Single shared household; money fully pooled.** No per-person budgets, no
  splitting, no "who owes whom".
- **All household members manage everything** — RLS is gated on household
  membership only; member attribution on a record is a tax/reporting tag, not a
  permission.
- **Income is projection-based.** The household owns many incomes, each a salary
  (annual gross), a wage (rate × standard hours), or other regular income, on a
  schedule, and each tagged to a member for tax. Entries are projections, not
  reconciled against actual deposits.
- **Tax is estimate-only.** Per-person estimated liability and take-home from
  projected income; models HELP repayment and private-hospital cover. Target
  financial year: FY2027. Tracking actual tax paid (PAYG withheld) is deferred.
- **Both bank with Up, but transaction ingestion is deferred.** Spending plans
  and savings goals track against actual spending and balances, so they wait
  until ingestion exists.

## Done

- Foundations: stack, monorepo scaffold, CI (`check` + `rls` jobs, under a
  minute), `main` protection ruleset, Vercel hosting.
- Household, members, and RLS isolation (schema + automated CI tests).
- Onboarding + Google OAuth; partner join via invite code (live in production).
- Ledger schema: accounts, transactions, categories (schema only, no UI yet).
- Pure tax engine (verified FY2027 config in progress).
- Up Bank sync scaffold (not yet functional).

## Now — Income + tax estimate (no ingestion required)

- [ ] `income` + `tax_profile` schema (RLS, tests, types).
- [ ] Verified FY2027 tax config (real ATO figures) + marginal HELP model.
- [ ] Tax computation: annualize incomes → per-person + household estimate.
- [ ] Income management UI.
- [ ] Tax-estimate view (per-person breakdown + household take-home).

## Next — Up ingestion

- [ ] Per-member Up token in Vault; webhook registration + signature handling.
- [ ] Account + transaction sync; scheduled poll; dedupe on `external_id`.
- [ ] Source-category to household-category mapping.

## Then — Ledger UI

- [ ] Accounts and transactions views over synced data.
- [ ] Manual entry + category management.

## Then — Spending plans

- [ ] Household budgets: category limits per period; actual-vs-plan over real
      transactions.

## Then — Savings goals

- [ ] Goals with targets and dates; progress from real balances.

## Later

- Reconcile projected income against actual deposits.
- Track actual tax paid (PAYG withheld) for a refund/bill vs estimate.
- Joint-income ownership split; net worth (assets and liabilities); recurring
  bills and forecasting; non-resident and part-year tax; notifications;
  additional bank sources / CSV import.
