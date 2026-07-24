# Architecture

## Stack

- **Backend platform:** [Supabase](https://supabase.com/) — managed Postgres,
  Auth, auto-generated REST API (PostgREST), Edge Functions (Deno/TypeScript),
  Vault (secrets), and Storage. Hosted in the **Sydney (AU)** region on the
  **Pro** tier (no project pausing; daily backups).
- **Clients:** a single **React PWA** (TypeScript) serving both iOS (installed
  via Safari → Add to Home Screen) and web. One frontend, no native app.
- **Frontend hosting:** [Vercel](https://vercel.com/) — the PWA's static build is
  deployed from the repo (Root Directory `apps/pwa`, Vite preset). Merges to
  `main` deploy to production; each PR gets a preview deployment. `apps/pwa/vercel.json`
  provides the SPA fallback rewrite. `VITE_SUPABASE_*` are set as Vercel env vars.
- **Shared code:** TypeScript packages shared between the PWA and edge functions
  (notably the tax engine).

Firebase and other document stores are out — the domain model is relational.

## Access pattern (hybrid)

Clients talk to the database in the way that fits each job:

- **Direct PostgREST + RLS** — plain CRUD the PWA does itself: transactions,
  categories, budgets, goals, accounts. No hand-written endpoints. Rules are
  enforced by DB constraints + Row-Level Security; correctness is aided by
  generated TypeScript types.
- **Edge functions (Deno/TypeScript)** — only what needs trusted server compute.
  Five live under `supabase/functions/`, auto-deployed to prod on merge (see
  *Local dev & delivery*): `up-connect` / `up-disconnect` (connect and clear a
  member's Up token), `up-sync` (poll saver balances), `up-webhook`
  (near-real-time receiver), and `changelog` (proxy GitHub for the in-app "What's
  new" feed; it accepts the client's build commit SHA and splits the raw commit
  list at it — that commit and older are `implemented` (so a stale/cached PWA
  never shows changes newer than its build), while the commits newer than it are
  returned as `available` so the tab can offer a one-tap reload to the latest
  deployed version). The Up functions hold Up tokens server-side (via
  Vault); `changelog` holds a GitHub PAT server-side. All are JWT-verified except `up-webhook`
  (`verify_jwt=false`, signature-verified instead). The pure tax engine runs
  client-side in the PWA; an authoritative server-side tax estimate is a future
  edge function.
- **SQL views / RPC** — derived reporting (spend-vs-budget, savings progress) and
  household management (`create_household`, `join_household`, and the temporary
  invite-code RPCs `create_invite_code` / `revoke_invite_code`), callable through
  the auto-generated API.

Custom code is limited to the two things that genuinely need it; everything else
is CRUD over RLS.

## Components

- **Database** — Postgres, source of truth. Every domain row carries a
  `household_id`.
- **Auth** — Supabase Auth via **Google OAuth**. Two accounts, one shared
  household. The Google consent screen is *published* (basic email/profile scopes
  need no verification review) to avoid the 7-day refresh-token expiry of testing
  mode. Note the iOS standalone-PWA OAuth redirect quirk — the round-trip may
  return to Safari rather than the installed app; handled via redirect-URL config.
- **PWA** — consumes PostgREST directly (RLS-enforced), runs the pure tax engine
  client-side, and calls the Up edge functions. `App.tsx` is a thin auth gate →
  onboarding branch → routed shell, with each tab a `routes/*Section.tsx`
  container. Client-side path routing via `react-router-dom` makes each tab
  deep-linkable and reload-safe (`apps/pwa/vercel.json` supplies the SPA fallback).
  Server state flows through TanStack Query — a household-scoped shared cache built
  on the `useHouseholdCollection` factory (`hooks/useCollection.ts`), so tab
  switches render cached data and background-revalidate. A write invalidates its
  table's whole `[table, householdId]` cache prefix, so both a match-scoped detail
  query and the unscoped roll-up of the same table refetch together — a derived
  value edited on one tab propagates live to every tab that reads it.
- **Design system** — a dark-first Mantine theme (custom `brand`/`dark`/semantic
  scales, Space Grotesk + Inter, tabular money) plus shared primitives
  (`AppCard`, `PageSection`, `ListRow`, `MoneyText`, and friends) that components
  reference instead of raw hex or ad-hoc styling. See
  [`design-system.md`](design-system.md).
- **Tax engine** — pure, versioned TypeScript package (`@nest/tax`). The PWA
  imports it for the instant client-side estimate. Designed to be reused
  unchanged by a future authoritative edge function, so there is no duplication
  or divergence. See [`tax.md`](tax.md).
- **Plan engine** — pure `@nest/plan` package: schedule normalization, summary
  reconciliation, goal projection, temporary expiry, and the `Frequency` type.
- **Import layer** — source-agnostic ingestion boundary; Up is the first adapter.

## Integrations

### Up Bank API

- Personal access token per member (no CDR accreditation required).
- Tokens stored encrypted in **Supabase Vault**; never exposed to clients. A
  member connects their token through the JWT-verified `up-connect` edge function
  (validated against Up, then written via the service-role-only `store_up_token`
  RPC) and clears it through `up-disconnect`. The token is written and read only
  by SECURITY DEFINER RPCs granted to `service_role` alone (`store_up_token` /
  `up_token_for_member` / `clear_up_token`); a member sees only a boolean status
  (`members.up_connected_at`). The initial Up scope funds savings goals from saver
  balances; spend/ledger reconciliation is deprioritised.
- **Webhook receiver** — the `up-webhook` edge function (pinned
  `verify_jwt=false` in `config.toml`) for near-real-time updates; verifies Up's
  HMAC signature.
- **Scheduled poll** — the `up-sync` edge function syncs saver balances
  (accounts only; transaction ingestion deferred). It runs `verify_jwt=true`, so
  the gateway validates the bearer's signature, and the handler then tells the
  caller apart by the JWT's `role` claim: a `service_role` JWT (the cron) syncs
  every connected household, while any other JWT resolves to a member and scopes
  the run to that member's household. The Goals-tab Refresh invokes it with the
  member's JWT; an hourly `pg_cron` job (`up-sync-hourly`) calls it through
  `pg_net` with the service-role key as a backstop. The schedule reads its
  invocation URL/key from Vault at run time and is guarded on both extensions, so
  it no-ops where they are absent. Sync writes go through the
  `upsert_up_accounts` RPC, which upserts each account's identity (dedupe on
  `(source, external_id)`) and its balance (on `account_id`) in one transaction.
- A goal links to a synced saver via `savings_goal.linked_account_id`; a linked
  goal's current balance comes from that account's balance in `account_balance`
  (read via the `accounts_with_balance` view).
- Each member links their own token; accounts are attributed to that member
  (joint accounts left owner-null) in the shared household ledger.
- Reference: <https://developer.up.com.au/>

## Security

- **RLS is the security boundary.** Policies grant access when `auth.uid()` maps
  to a member of the row's household; joint vs owner-scoped rows handled in
  policy. Balances live in `account_balance` (split out of the identity table so
  the account surfaces need no SECURITY DEFINER view) and, with `transactions`,
  add per-account balance privacy on top: a member sees a balance and its
  transactions only for shared, own, or household super accounts, gated by
  `visible_balance_account_ids()`. A co-member's spending account is exposed by
  name (no balance) through the `account_directory` view; both it and
  `accounts_with_balance` are plain invoker views (`security_invoker = on`), so no
  view reads past the caller's RLS. Tested deliberately (pgTAP / integration
  tests), not by inspection.
- Up tokens and webhook secrets encrypted at rest (Vault).

## Cross-cutting conventions

- **Money** — integer minor units (cents); never floats.
- **Time** — AU financial year (1 Jul – 30 Jun); store UTC, present in the
  household timezone (`Australia/…`).

## Local dev & delivery

- **Supabase CLI** runs the full stack locally in Docker; SQL migrations are
  version-controlled; TypeScript types are generated from the schema.
- Migrations auto-deploy to prod via the GitHub → Supabase integration on merge;
  edge functions auto-deploy via `.github/workflows/deploy-functions.yml` on any
  push to `main` touching `supabase/functions/**` or `supabase/config.toml`.
## CI

Parallel GitHub Actions jobs (`.github/workflows/ci.yml`), each on its own runner
so overall wall-clock is the slowest single job, not the sum. A push supersedes
an in-flight run for the same ref (`concurrency` with `cancel-in-progress`), and
the workflow token is scoped `contents: read`:

- **check** — lint / format / typecheck / build (~49s). Not the binding
  constraint.
- **test** — the Vitest workspace, sharded across six parallel runners with V8
  coverage. A `test-shard` matrix job runs
  `vitest run --shard=N/6 --coverage --reporter=blob` on six runners (each
  covering a sixth of the files, the union running every test) and uploads its
  blob report; a `test` job downloads all six and merges them with
  `vitest run --merge-reports --coverage`, failing if a package drops below its
  threshold: `@nest/plan` and `@nest/tax` at 100% on every metric, `apps/pwa` at
  100% statements / functions / lines with a branch floor (currently 93). The
  thresholds evaluate over the merged coverage of the whole suite; a shard sets
  `VITEST_SKIP_COVERAGE_THRESHOLDS` so its partial coverage does not fail the
  check. The `test` job `needs` the shards, so the required-check name stays green
  only when all six pass.
- **rls** — Postgres service; applies the auth shim, every migration in order,
  then the `supabase/tests/rls/` isolation assertions.
- **functions** — Deno `fmt --check` / `lint` / `check` / `test` over
  `supabase/functions` (the edge functions live outside the pnpm workspace, with
  their own Deno harness).

A `ci-status` job `needs` all four and is the single required `CI Status` check
(squash-only, no bypass).

Each pnpm job (`check`, `test-shard`, `test`) sets up the toolchain the same way:
`actions/setup-node` installs Node, then `corepack enable` /
`corepack prepare pnpm@11.14.0 --activate` provides the pnpm version pinned in the
root `package.json` `packageManager` field — no separate `pnpm/action-setup`. The
pnpm content-addressable store is restored by `actions/cache` keyed on
`pnpm-lock.yaml`, so a warm `pnpm install --frozen-lockfile` links packages from
cache rather than downloading them. The Deno `functions` job keeps its own
`setup-deno` cache.

The binding constraint on wall-clock is the serialized `test-shard` → `test`
chain: the shards run in parallel, then the `test` merge job waits on them and
runs afterwards, so their durations add. The merge itself replays the recorded
runs in a few seconds; the rest of that job is checkout, Node/pnpm setup, and
`pnpm install` — the tail the warm store cache and corepack setup shrink, since
the shards already run concurrently and the merge cannot start until they
finish.

Beyond the jobs, three static gates keep the tree tidy: Prettier sorts imports
via `@ianvs/prettier-plugin-sort-imports` (`.prettierrc.json`); an oxlint
`max-lines` cap of 500 (`.oxlintrc.json`, off for tests and generated types)
guards file size; and the edge functions pin every dependency through
`supabase/functions/deno.lock`.
