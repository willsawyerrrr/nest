# Handoff

Operational state for an agent picking up the project. Design and scope live in
the docs linked below; this covers what is live, where it runs, and how to work
on it.

## Current status

The plan-only app is live at <https://budget.willsawyerrrr.dev>. It fully
replaces the household's spreadsheet. Tabs, in order: **Summary** (landing) ·
**Inflows** · **Budget** · **Goals** · **Tax** · **Household**. The household's
real budget (34 budget lines) and income are loaded in production.

The next build phase is **Up ingestion + reconciliation** — see
[`ROADMAP.md`](ROADMAP.md).

## Stack

- **PWA** — React + Vite (`apps/pwa`), Mantine, mobile-first (primary device is
  an installed iPhone PWA). Direct PostgREST + RLS for CRUD.
- **Backend** — Supabase (Postgres, Auth, PostgREST, Edge Functions, Vault),
  Sydney region, Pro tier.
- **Pure TS packages** — `@budget/tax` (tax engine + verified FY2027 config,
  `configsByYear`) and `@budget/plan` (budget / summary / goal math). Both
  I/O-free, unit-tested, shared by the PWA.

Details: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Repo / dev workflow

Bare-container git worktrees via the user's `git wt` / `git wt-clone` tooling:
the repo root is a container holding `.bare/` with worktrees beside it (`main/`,
`feat/<x>/`, …).

- Create a worktree: `git wt <branch> origin/main`.
- Remove after merge: `git wt -D <branch>`.
- `.bare/config` carries hooks: `wt.hook = pnpm install`,
  `wt.copy = apps/pwa/.env` (each new worktree installs deps and gets the env
  file).
- Name worktrees after their branches. Work only inside your own worktree; never
  touch `.bare`, `main`, or another worktree.

Claude drives PRs autonomously here — opens and merges on green CI, no per-turn
confirmation. Commits are SSH-signed via the user's 1Password SSH agent. If
signing fails ("communication with agent failed"), the user must unlock
1Password; never fall back to `--no-gpg-sign`.

## CI

Three parallel GitHub Actions jobs (`.github/workflows/ci.yml`), each on its own
runner so wall-clock is the slowest single job:

- **check** — lint / format / typecheck / build.
- **test** — Vitest workspace.
- **rls** — Postgres service + `supabase/tests/rls/` isolation assertions.

Branch-protection ruleset "Protect main" requires all three, squash-only, no
bypass. Actions pinned to the Node 24 runtime. Keep CI under a minute; `check`
is the long pole at ~59s (build / typecheck growth) — if it crosses a minute,
the next lever is trimming the build / install step.

## Supabase

- Production project ref **`dgfeittjtxjtgbretdkj`** (Sydney, Pro).
- Migrations auto-deploy to prod via the GitHub → Supabase integration on merge
  to `main` (branching off).
- **RLS is the security boundary** — policies gate on household membership via
  the `public.household_ids_for_current_user()` SECURITY DEFINER helper.
- Local dev: `pnpm supabase start` (Docker) + `pnpm supabase db reset` +
  `pnpm db:types`.
- A Supabase Management API personal access token is at
  `~/.config/claude/supabase_pat` (config + data automation). The user intends
  to rotate it — do not assume it persists.

## Auth

Supabase Google OAuth. Site URL and redirect allow-list are configured for
`budget.willsawyerrrr.dev`, `budget.vercel.app`,
`budget-*-willsawyerrrr.vercel.app` previews, and `localhost:5173`.

## Hosting

Vercel project **`budget`**, Root Directory `apps/pwa` (Vite preset). Auto-deploy
on merge to `main`, preview deployment per PR. Custom domain
`budget.willsawyerrrr.dev`. Env vars: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`.

## Data model

Inflows (taxable income + non-taxable), tax_profile, budget_line (groups:
needs / wants / discretionary / temporary / savings / investments),
temporary_item, savings_goal, households / members. Details:
[`DATA_MODEL.md`](DATA_MODEL.md), [`budget-and-savings.md`](budget-and-savings.md),
[`TAX.md`](TAX.md).

## Immediate follow-ups / open items

- The user is adding savings-goal **targets** via the Goals tab: Emergency Fund
  $40k, Home Deposit $50k, Home Buffer $30k.
- Watch the `check` CI time (currently ~59s).
- Rotate the Supabase Management API token when done with it.
- Next build phase: Up ingestion + reconciliation ([`ROADMAP.md`](ROADMAP.md)).
