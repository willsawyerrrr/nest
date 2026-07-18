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
- Income: the household owns many projection-based incomes — each a salary,
  wage, or other regular income on a schedule — each tagged to a member for tax.
- Tax: full AU income tax, versioned per financial year; estimate-only
  (actual-paid tracking deferred), per-person, modelling HELP debt and
  private-hospital cover; target financial year FY2027.
- Ingestion: both partners bank with Up, but transaction ingestion is deferred;
  spending plans and savings goals depend on it. Sources (Up Bank API + manual
  entry) are source-agnostic.

## Conventions

- Money is stored as integer minor units (cents); never floats.
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- Commit messages: Conventional Commits, first word capitalised, scoped where it
  helps (e.g. `feat(tax): Add LITO taper`).
- Feature work on branches → PRs; keep `main` releasable.
- Claude drives pull requests autonomously in this repo — opening, updating, and
  merging them — without per-turn confirmation. Branches merge once CI is green.
- CI must complete in under 1 minute. If a run exceeds that, diagnosing and
  reducing CI time takes priority over other work. Checks run sequentially in a
  single job after one dependency install: on a 2-vCPU hosted runner, running the
  CPU-bound checks concurrently only causes contention and inflates each one
  without improving wall-clock time.
