# Handoff

Operational state for an agent picking up the project cold: what is live, where
it runs, how to work on it, and what is open. Design and scope live in the docs
linked throughout; this covers the operational reality.

## Current status

Two layers are live in production at <https://budget.willsawyerrrr.dev>.

**Plan-only app** — fully replaces the household's spreadsheet and needs no
transaction data. Income + AU tax estimate, a fortnightly plan-only budget,
savings goals, and a Summary reconciliation. Tabs are path-routed via
`react-router-dom` (`/summary` `/net-worth` `/inflows` `/budget` `/goals` `/tax`
`/super` `/household`; `/` and unknown routes redirect to `/summary`), so they are
deep-linkable and reload-safe. Order: **Summary** (landing) · **Net worth** ·
**Inflows** · **Budget** · **Goals** · **Tax** · **Super** · **Household**.
Keyboard shortcuts: ⌘/Ctrl+1–8 select a tab, ⌘/Ctrl+Shift+←/→ cycle. Tax
profiles are edited on the Household tab. The household's real budget and income
are loaded in production.

**Superannuation & net worth** — the Super tab edits each member's fund name and
current balance for the financial year; the balance is held as a manual account
linked from `super_profile.linked_account_id` (the same balance-source pattern
savings goals use). Each member's `super_contribution` rows are also managed there
(add/edit/delete: kind, amount or percent-of-salary, frequency, FHSS flag, spouse
contributor). Concessional kinds (salary sacrifice + personal deductible) reduce
the tax estimate — lowering taxable income and after-tax income (so the Tax tab
shows a Division 293 line for high earners and the Summary's available income
reflects the super diverted from cash). Each member's card also shows their
concessional and non-concessional cap usage (the concessional cap includes their
manual carry-forward), warns when either cap is exceeded, and estimates the
government co-contribution when it applies. Below the members, a retirement
projection compounds each member's current balance plus their net-of-15%-tax
annual contribution (concessional and employer SG taxed in the fund;
non-concessional and co-contribution untaxed) to retirement, showing the result
in nominal and today's (real) dollars. The projection math is pure
(`projectSuperBalance` in `@budget/plan`); the shared return/inflation/growth and
retirement-age assumptions and each member's age are client-side inputs persisted
in localStorage, not stored in the database. The Net worth tab sums every
account's `balance_cents` (assets only; liabilities not modelled yet), split into
Super vs Other accounts.

**Up savers → savings goals** — built, merged, and deployed. Each member
connects their Up personal access token on the Household tab; a goal links to a
synced Up saver so its progress and ETA track the real balance. Server-side sync
runs on demand (a Goals-tab Refresh button) and hourly (a `pg_cron` backstop).
Transaction ingestion (spend/ledger reconciliation, actual PAYG vs estimate)
stays deferred — see [`ROADMAP.md`](ROADMAP.md).

## Stack

- **PWA** — React + Vite (`apps/pwa`), Mantine, mobile-first (primary device is
  an installed iPhone PWA). Direct PostgREST + RLS for CRUD. `react-router-dom`
  for client-side path routing; `@mantine/charts` + `recharts` for the Summary
  allocation donut; `@tabler/icons-react` for icon actions (Edit / Delete).
- **Backend** — Supabase (Postgres, Auth, PostgREST, Edge Functions, Vault),
  Sydney region, Pro tier.
- **Pure TS packages** — `@budget/tax` (tax engine + verified FY2027 config,
  `configsByYear`) and `@budget/plan` (budget / summary / goal math, including
  the `Frequency` type). Both I/O-free, unit-tested, shared by the PWA.
- **Edge functions** — Deno/TypeScript under `supabase/functions/`, outside the
  pnpm workspace, with their own `deno.json` and test harness. Four functions:
  `up-connect`, `up-disconnect`, `up-sync`, `up-webhook`.

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
  touch `.bare`, `main`, or another worktree. Never fast-forward the `main`
  worktree.

Claude drives PRs autonomously here — opens and merges on green CI, no per-turn
confirmation. Branches squash-merge once the required checks pass.

### SSH signing gotcha (read before any git commit/push)

Commits are SSH-signed via the user's 1Password SSH agent. A non-interactive
shell (the agent harness) defaults `SSH_AUTH_SOCK` to the launchd agent, **not**
1Password, so signing and pushing fail unless you point it at the 1Password
socket first:

```sh
export SSH_AUTH_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
```

Export that in the same shell before every commit/push. Guard the signing call
so a locked agent can't hang the turn, e.g.
`perl -e 'alarm 60; exec @ARGV' git commit -S -m …`. If signing fails
("communication with agent failed" / "agent refused operation"), STOP and ask
the user to unlock 1Password — never fall back to `--no-gpg-sign`.

## CI

Four parallel GitHub Actions jobs (`.github/workflows/ci.yml`), each on its own
runner so wall-clock is the slowest single job:

- **check** — lint / format / typecheck / build. The long pole (~50–59s);
  watch it, since it is what keeps overall CI near the one-minute budget.
- **test** — the Vitest workspace, sharded across parallel runners. A
  `test-shard` matrix job runs `vitest run --shard=N/2` on two runners (each
  covering half the files, the union running every test); a lightweight `test`
  job `needs` both shards so the required `test` check stays green only when both
  shards pass and the required-check name is preserved.
- **rls** — Postgres 17 service; applies the auth shim, every migration in
  order, then `supabase/tests/rls/` isolation assertions (~22s).
- **functions** — Deno `fmt --check` / `lint` / `task check` / `test` over
  `supabase/functions` (the edge functions live outside the pnpm workspace,
  pinned to Deno 2.9.3).

Branch-protection ruleset "Protect main" requires **check**, **test**, **rls**,
and **functions**; squash-only, no bypass. Keep CI under a minute; the next lever
if `test` creeps up is a third shard, and `check` is the job to profile first.

## Supabase

- Production project ref **`dgfeittjtxjtgbretdkj`** (Sydney, Pro).
- **Migrations** auto-deploy to prod via the GitHub → Supabase integration on
  merge to `main`. SQL migrations are version-controlled under
  `supabase/migrations/` and are authoritative for the schema.
- **Edge functions** auto-deploy to prod on merge via
  `.github/workflows/deploy-functions.yml`: a push to `main` touching
  `supabase/functions/**` or `supabase/config.toml` runs
  `supabase functions deploy --project-ref dgfeittjtxjtgbretdkj`, deploying every
  function and honouring each one's `verify_jwt` from `config.toml` (`up-webhook`
  is pinned `false`; the rest default to `true`). It authenticates with the
  `SUPABASE_ACCESS_TOKEN` GitHub Actions secret.
  - **Token caveat:** the deploy uses `SUPABASE_ACCESS_TOKEN` (the Management-API
    PAT) as a GitHub secret, and the same PAT is stored at
    `~/.config/claude/supabase_pat` for local config/data automation. If it is
    rotated, update **both** the GitHub secret **and** the local file, or CD
    breaks.
- **RLS is the security boundary** — policies gate on household membership via
  the `public.household_ids_for_current_user()` SECURITY DEFINER helper.
- **Vault** holds all secrets that must never reach a client: each member's Up
  token (`up_token:<member_id>`) and the hourly-cron config (`up_sync_cron_url`,
  `up_sync_cron_key`). Tokens are written/read/cleared only by the
  service-role-only SECURITY DEFINER RPCs (see the Up section).
- **`service_role` grants** — `service_role` has NO blanket table access. It
  holds only the grants the Up functions need: `select` on `members` and
  `select`/`insert`/`update` on `accounts` (migration
  `20260719050000_service_role_ledger_grants.sql`). The token RPCs are SECURITY
  DEFINER and need no table grants. Any future server-side code touching other
  public tables must add its own grants deliberately — see the open items.
- Local dev: `pnpm supabase start` (Docker) + `pnpm supabase db reset` +
  `pnpm db:types`.
- A Supabase Management-API PAT is at `~/.config/claude/supabase_pat` (config +
  data automation). The user intends to rotate it — do not assume it persists,
  and keep it in sync with the GitHub secret (above).

## Auth

Supabase Google OAuth (consent screen published). Site URL and redirect
allow-list cover `budget.willsawyerrrr.dev`, `budget.vercel.app`,
`budget-*-willsawyerrrr.vercel.app` previews, and `localhost:5173`.

A partner joins with a temporary, opt-in, single-use invite code. A household
carries no code by default; a member mints one via `create_invite_code` (an
8-char code, 7-day expiry) and can clear it via `revoke_invite_code`.
`join_household(p_code, p_member_name)` accepts only an unexpired code and
consumes it on join. No email infrastructure.

## Hosting

Vercel project **`budget`** on the **Pro** plan, Root Directory `apps/pwa` (Vite
preset). Prod deploys via the GitHub integration on merge to `main`; each PR gets
a preview deployment. Custom domain `budget.willsawyerrrr.dev`.
`apps/pwa/vercel.json` supplies the SPA fallback rewrite. Env vars:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Live prod may briefly trail `main`
until the next merge triggers a deploy.

## Up integration (operational)

- **Connect** — a member pastes their Up personal access token on the Household
  tab. The JWT-verified `up-connect` edge function resolves the member from the
  JWT (never the body), validates the token against Up, then stores it via the
  service-role-only `store_up_token` RPC (encrypted in Vault). `up-disconnect`
  clears it via `clear_up_token`. The client only ever sees a boolean status
  (`members.up_connected_at`); the token is never returned. `up_connected_at` is
  locked to service-role writes — `authenticated` holds column-scoped UPDATE on
  `(name, email)` only, so a client cannot forge its connection status.
- **Sync** — `up-sync` is accounts-only: it enumerates members with
  `up_connected_at` set, reads each token via `up_token_for_member` as service
  role, calls the Up API, and upserts Up accounts into `public.accounts` on
  conflict `(source, external_id)`. Transaction ingestion is deferred.
- **Two callers, one function** — `up-sync` runs with `verify_jwt=true`, so the
  gateway validates the bearer's signature before the handler runs. The handler
  then distinguishes the caller by the JWT's `role` claim
  (`up-sync/auth.ts` → `isServiceRoleToken`):
  - a `service_role` JWT (the cron) syncs **every** connected household;
  - any other JWT is resolved to a member and scoped to **that member's**
    household (RLS-independent, since the sync itself uses the service role).
  The Goals-tab **Refresh** button invokes `up-sync` with the member's JWT and
  refetches savers + goals.
- **Hourly cron** — migration `20260719040000_up_sync_schedule.sql` schedules
  `up-sync-hourly` (`0 * * * *`) via `pg_cron` + `pg_net`. It is guarded on both
  extensions, so it applies as a clean no-op in CI / local Postgres and only
  schedules on Supabase. The scheduled command reads the invocation URL and key
  from Vault at run time (`up_sync_cron_url`, `up_sync_cron_key`) and POSTs with
  `Bearer <service-role key>` — a `service_role` JWT, which is exactly what the
  handler's role check accepts as the cron path.
- **Deploy-time config for the cron (prod only):**
  1. The function auto-deploys via CD (above).
  2. Set the two Vault secrets (the migration reads them at run time; rotating
     the key is a Vault change, not a re-migration):
     ```sql
     select vault.create_secret('https://dgfeittjtxjtgbretdkj.supabase.co/functions/v1/up-sync', 'up_sync_cron_url');
     select vault.create_secret('<service-role-key>', 'up_sync_cron_key');
     ```
  3. Re-run the migration (or `supabase db push`) once the secrets exist so the
     job schedules. It unschedules any prior `up-sync-hourly` first, so it is
     safe to re-run; absent the secrets it leaves the job unscheduled. Verify
     with `select * from cron.job where jobname = 'up-sync-hourly';`.
- **State today** — functions are deployed; the hourly cron is scheduled and
  active (Vault secrets set); manual Refresh and the hourly poll both work.

## Data model

Inflows (taxable income + non-taxable; schedules from weekly through annual plus
an "every N weeks" cadence carrying `interval_weeks`), tax_profile, budget_line
(groups: needs / wants / discretionary / savings / investments), temporary_item,
savings_goal (nullable `linked_account_id` → a synced Up saver), households /
members (households carry nullable `invite_code` + `invite_code_expires_at`;
members carry nullable `up_connected_at`), and the ledger tables (accounts,
transactions, categories). `accounts` is populated by `up-sync` for Up savers;
`transactions` remains unpopulated pending ingestion. Details:
[`DATA_MODEL.md`](DATA_MODEL.md), [`budget-and-savings.md`](budget-and-savings.md),
[`TAX.md`](TAX.md).

## Open items / next

- **Superannuation** — the active next phase (full modelling), scoped and
  sub-phased in [`ROADMAP.md`](ROADMAP.md); not yet modelled in code.
- **`service_role` grant policy** — decide whether to keep grants surgical
  (per-feature, as now) or broaden them. Current stance is surgical; any new
  server-side code must add its own grants.
- **Up ledger + reconciliation** (deferred): transaction sync (webhook +
  scheduled poll, dedupe on `external_id`), a ledger UI, spend-vs-budget
  reconciliation, and actual PAYG-vs-estimate tracking. See [`ROADMAP.md`](ROADMAP.md).
- **Spreadsheet-parity gaps** (in [`spreadsheet-parity.md`](spreadsheet-parity.md)):
  itemised sub-budget (line-item breakdown, e.g. the gift budget), a
  payment-method tag per budget line, a wishlist, and a finance-admin to-do list.
- **CI watch** — `check` (~50–59s) is the long pole near the one-minute budget;
  profile it first if CI creeps up, then consider a third `test` shard.
- **Supabase Management-API token** — rotate when done; keep the GitHub secret
  and `~/.config/claude/supabase_pat` in sync.
</content>
</invoke>
