# CLAUDE.md

## Purpose

Household budgeting app for two people: income tracking, full AU income-tax
modelling, spending plans, and savings goals. See [`README.md`](README.md) and
[`docs/`](docs/) for scope and design.

## Fixed scope decisions

- Platform: one PWA for both iOS (installed via Safari) and web. No native app.
- Backend: Supabase (Sydney, Pro) — Postgres, Auth, PostgREST, Edge Functions,
  Vault. Direct PostgREST + RLS for CRUD; edge functions for tax engine + Up sync.
- Frontend: React PWA (TypeScript); one frontend for iOS + web.
- UI framework: Mantine (React components + theming; system light/dark). The app
  is designed mobile-first — the primary device is an installed iPhone PWA.
- Frontend hosting: Vercel (Root Directory `apps/pwa`, Vite preset); auto-deploy
  on merge to `main`, preview deploys per PR.
- Auth: Supabase Auth via Google OAuth (consent screen published).
- Language: TypeScript across PWA and edge functions; tax engine is a shared
  package.
- Household & money: the two partners share ONE household with money fully
  pooled — no multi-household UI (no picker or switcher), no per-person budgets
  or splitting. All household members can manage everything: RLS is gated on
  household membership only, and record attribution to a member is a
  tax/reporting tag, not a permission. `household_id` + RLS isolate the
  household's data from all other Supabase users. A partner joins via an invite
  code (`join_household` RPC); no email infrastructure.
- Inflows: the household owns many projection-based inflows, split by taxability
  — taxable income (salary, wage, or other regular income on a schedule, each
  tagged to a member for tax) and non-taxable inflows (e.g. reimbursements,
  excluded from tax and added to available cash).
- Tax: full AU income tax, versioned per financial year; estimate-only
  (actual-paid tracking deferred), per-person, modelling HELP debt and
  private-hospital cover; target financial year FY2027.
- Budgeting is plan-only and fortnightly: the household allocates projected
  after-tax income across grouped categories (Needs / Wants / Discretionary /
  Temporary / Savings / Investments) with a live remaining buffer; actual-spend
  reconciliation via Up ingestion is a later enhancement.
- Ingestion: both partners bank with Up, but transaction ingestion is deferred;
  spending plans and savings goals depend on it. Sources (Up Bank API + manual
  entry) are source-agnostic.

## Conventions

- Money is stored as integer minor units (cents); never floats.
- Integer-cent numeric literals are grouped to read as dollars: a trailing `_NN`
  for the cents, then `_NNN` groups for the dollars (e.g. `18_200_00` = $18,200.00).
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- Commit messages: Conventional Commits, first word capitalised, scoped where it
  helps (e.g. `feat(tax): Add LITO taper`).
- Feature work on branches → PRs; keep `main` releasable.
- Claude drives pull requests autonomously in this repo — opening, updating, and
  merging them — without per-turn confirmation. Branches merge once CI is green.
- CI must complete in under 1 minute. If a run exceeds that, diagnosing and
  reducing CI time takes priority over other work. CI runs as separate parallel
  jobs — `check` (lint, format, typecheck, build), `test` (the Vitest suite), and
  `rls` (RLS isolation on a Postgres service) — each on its own runner, so overall
  wall-clock is the slowest single job, not the sum. Steps WITHIN a job stay
  sequential: on a single 2-vCPU runner, running CPU-bound steps concurrently only
  causes contention and inflates each one without improving wall-clock time.
  Splitting into separate jobs avoids that by giving each its own runner.
