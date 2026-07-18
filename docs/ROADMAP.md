# Roadmap

Phased so each phase is independently useful. Framework chosen at the start of
Phase 1.

## Phase 0 — Foundations (current)

- [x] Scope decisions (platform, data, feeds, tax depth).
- [x] Architecture, data model, and tax design docs.
- [x] Backend stack: Supabase + PWA + TypeScript; direct PostgREST + RLS.
- [x] Frontend framework (React PWA) and auth method (Google OAuth).
- [ ] Supabase project (Sydney, Pro); CLI + local Docker stack.
- [ ] Repo tooling: linting, formatting, CI, test runner.

## Phase 1 — Ledger core

- [ ] Data model migrations: household, members, accounts, transactions,
      categories.
- [ ] Manual transaction entry (income/expense/transfer).
- [ ] Category management + transfer exclusion from reporting.
- [ ] Basic web + iOS views: account list, transaction list.

## Phase 2 — Up Bank integration

- [ ] Per-member Up token linking (encrypted at rest).
- [ ] Account + transaction sync; dedupe via `external_id`.
- [ ] Webhook handling for near-real-time updates.
- [ ] Source-category → household-category mapping.

## Phase 3 — Tax engine

- [ ] Versioned `TaxYearConfig` with one verified FY loaded.
- [ ] Pure tax engine + golden-file tests.
- [ ] Payslip/income-event entry feeding taxable income and withholding.
- [ ] Per-member liability vs withheld dashboard.

## Phase 4 — Spending plans

- [ ] Budgets and budget lines per category/period.
- [ ] Actual-vs-plan reporting.

## Phase 5 — Savings goals

- [ ] Goals with targets and dates; progress tracking.
- [ ] Required-contribution-rate calculation.

## Later

- Additional bank sources / CSV import.
- Non-resident and part-year tax cases.
- Notifications, forecasting, shared insights.
