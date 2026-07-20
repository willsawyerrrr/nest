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
  household's data from all other Supabase users. A partner joins via a
  temporary, opt-in, single-use invite code (`create_invite_code` mints one,
  `join_household` redeems and consumes it, `revoke_invite_code` clears it); no
  email infrastructure.
- Inflows: the household owns many projection-based inflows, split by taxability
  — taxable income (salary, wage, or other regular income on a schedule — weekly
  through annual, or an arbitrary every-N-weeks cadence — each tagged to a member
  for tax) and non-taxable inflows (reimbursement, hobby income, gift, or other —
  the type is a reporting label, excluded from tax and added to available cash).
- Tax: full AU income tax, versioned per financial year; estimate-only
  (actual-paid tracking deferred), per-person, modelling HELP debt and
  private-hospital cover; target financial year FY2027.
- Superannuation: modelled in full per person. Concessional contributions reduce
  taxable income and are taxed at 15% in the fund, with Division 293 for high
  earners; contribution caps (with manual carry-forward) and the government
  co-contribution are modelled, all from the versioned per-FY config alongside the
  tax config. Each member's balance is a dated baseline that auto-accrues modelled
  contributions between manual true-ups, seeds a net-worth view (assets only), and
  projects to retirement under client-side (localStorage) return/age assumptions.
- Budgeting is plan-only and fortnightly: the household allocates projected
  after-tax income across grouped categories (Needs / Wants / Discretionary /
  Temporary / Savings / Investments) with a live remaining buffer; actual-spend
  reconciliation via Up ingestion is a later enhancement. Each line carries an
  amount on a frequency (weekly through annual, or an arbitrary every-N-weeks
  cadence, exactly as inflows do), normalised to fortnightly and annual. A budget
  line's amount can be **derived** — rolled up from an itemised tracker via
  `budget_line.derived_source` rather than typed. Gift budget tracking (a
  per-recipient × occasion planner + purchase log) is the first such consumer. A
  line can also be **routed** to the account that funds it via
  `budget_line.destination_account_id` (Savings/Investments route through their
  goal's linked saver instead); the Splits tab sums each account's routed lines
  into a recommended fortnightly Up pay split. Up exposes no pay-split API, so
  splits are recommend-only — computed here, typed into Up by hand.
- Ingestion: both partners bank with Up. The savers → savings-goals slice is
  built and deployed — members connect an Up personal-access token (held in
  Vault), and `up-sync` polls saver balances into `accounts` so a linked goal
  tracks the real balance. Up transaction ingestion (spend/ledger reconciliation,
  actual tax paid) is deferred. Sources (Up Bank API + manual entry) are
  source-agnostic. Edge functions (`up-connect` / `up-disconnect` / `up-sync` /
  `up-webhook`) live under `supabase/functions/` and auto-deploy to prod on merge
  via `.github/workflows/deploy-functions.yml`.

## Conventions

- Money is stored as integer minor units (cents); never floats.
- Integer-cent numeric literals are grouped to read as dollars: a trailing `_NN`
  for the cents, then `_NNN` groups for the dollars (e.g. `18_200_00` = $18,200.00).
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- Commit messages: Conventional Commits, first word capitalised, scoped where it
  helps (e.g. `feat(tax): Add LITO taper`).
- Feature work on branches → PRs; keep `main` releasable.
- Keep documentation in sync with the code. When a change alters behaviour,
  schema, scope, or a workflow, update the affected docs (`docs/` and this file)
  as part of the same change, so `main` is never merged with stale docs.
- Claude is the driver of everything in this repo. It makes changes of every kind
  — code, schema, migrations, docs, CI, config — and owns the full git and PR
  lifecycle autonomously: branching, committing, pushing, and opening, updating,
  and merging pull requests, all without per-turn confirmation.
- Merge PRs via GitHub auto-merge (`gh pr merge --auto`), not by polling for CI to
  go green. Enable it once the PR is open; GitHub merges the moment the required
  checks pass.
- The driving agent delegates every piece of work to subagents rather than doing
  it inline, staying free to plan and take direction from the user. Launch
  independent subagents concurrently; reserve the main thread for orchestration
  and conversation.
- Every piece of work happens in its own dedicated git worktree named after its
  branch. This repo is a bare + per-branch-worktree layout (`.bare` plus a
  worktree per branch), so isolating each task in its own worktree keeps
  parallel subagents from sharing a working tree or colliding on git state.
- CI must complete in under 1 minute. If a run exceeds that, diagnosing and
  reducing CI time takes priority over other work. CI runs as separate parallel
  jobs — `check` (lint, format, typecheck, build), `test` (the Vitest suite,
  sharded across runners), `rls` (RLS isolation on a Postgres service), and
  `functions` (Deno fmt/lint/check/test over `supabase/functions`) — all required,
  each on its own runner, so overall wall-clock is the slowest single job, not the
  sum. Steps WITHIN a job stay
  sequential: on a single 2-vCPU runner, running CPU-bound steps concurrently only
  causes contention and inflates each one without improving wall-clock time.
  Splitting into separate jobs avoids that by giving each its own runner.
