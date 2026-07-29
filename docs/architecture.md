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
  Eight live under `supabase/functions/`, auto-deployed to prod on merge (see
  *Local dev & delivery*): `up-connect` / `up-disconnect` (connect and clear a
  member's Up token), `up-sync` (poll every Up account's balance, then the
  gift-category transaction window), `up-webhook`
  (near-real-time receiver), `changelog` (proxy GitHub for the in-app "What's
  new" feed; it accepts the client's build commit SHA and splits the raw commit
  list at it — that commit and older are `implemented` (so a stale/cached PWA
  never shows changes newer than its build), while the commits newer than it are
  returned as `available` so the tab can offer a one-tap reload to the latest
  deployed version), `push-key` / `push-test` (see *Push notifications*), and
  `payslip-extract` (read the figures off an uploaded payslip with Claude Haiku 4.5
  so the member can confirm them: it takes the Storage object path of an
  already-uploaded file, checks that path's household prefix against the caller's
  own household, forces a nullable tool schema so an absent figure comes back null
  rather than invented, converts each amount from the literal printed text to
  integer cents in TypeScript, and **writes no figure** — the member confirms the
  pre-filled form and their own save is what persists). The Up functions hold Up
  tokens server-side (via Vault); `changelog` holds a GitHub PAT server-side; the
  push functions hold the VAPID keypair; `payslip-extract` reads its Anthropic key
  from Vault. All are JWT-verified except `up-webhook`
  (`verify_jwt=false`, signature-verified instead). The pure tax engine runs
  client-side in the PWA; an authoritative server-side tax estimate is a future
  edge function.
- **SQL views / RPC** — derived reporting (spend-vs-budget, savings progress) and
  household management (`create_household`, `join_household`, and the temporary
  invite-code RPCs `create_invite_code` / `revoke_invite_code`), callable through
  the auto-generated API. The Vault, Up-sync, and RLS-helper functions are covered
  where they are used, below; the full index is in
  [`data-model.md`](data-model.md#rpcs).
- **Database triggers** — the derived budget lines (breakdown roll-ups and gift
  lines) are maintained by `SECURITY DEFINER` triggers, not by client code:
  `reconcile_derived_lines` re-derives a household's lines whenever a roll-up
  source changes. Granted to no role, so it is reachable only as its owner from
  those triggers. Business logic lives in the database wherever an invariant must
  hold no matter which client writes — see
  [`data-model.md`](data-model.md#reconcile).

Custom code is limited to what genuinely needs it; everything else is CRUD over
RLS.

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
- **Storage** — private buckets for the documents the household attaches:
  `receipts` (deduction receipts) and `payslips` (payslip PDFs/images). The PWA
  uploads directly and views a file through a short-lived signed URL it mints
  itself; both calls are gated by the bucket's Storage RLS, so no edge function
  brokers a file. Object keys lead with `<household_id>`, which is what the
  policies match on — see *Security* and
  [`data-model.md`](data-model.md#storage-buckets).

## Integrations

### Up Bank API

- Personal access token per member (no CDR accreditation required).
- Tokens stored encrypted in **Supabase Vault**; never exposed to clients. A
  member connects their token through the JWT-verified `up-connect` edge function
  (validated against Up, then written via the service-role-only `store_up_token`
  RPC) and clears it through `up-disconnect`. The token is written and read only
  by SECURITY DEFINER RPCs granted to `service_role` alone (`store_up_token` /
  `up_token_for_member` / `clear_up_token`); a member sees only a boolean status
  (`members.up_connected_at`). The Up scope funds savings goals from saver
  balances and offers gift-category card spend as candidate gift purchases;
  general spend/ledger reconciliation is deprioritised.
- **Webhook receiver** — the `up-webhook` edge function (pinned
  `verify_jwt=false` in `config.toml`) for near-real-time updates; verifies Up's
  HMAC signature. It persists nothing yet: gift-category ingestion runs on the
  `up-sync` poll instead, because Up raises no event when a transaction is
  recategorised.
- **Scheduled poll** — the `up-sync` edge function syncs every account's balance
  and ingests gift-category transactions. It runs `verify_jwt=true`, so
  the gateway validates the bearer's signature, and the handler then tells the
  caller apart by the JWT's `role` claim: a `service_role` JWT (the cron) syncs
  every connected household, while any other JWT resolves to a member and scopes
  the run to that member's household. The Goals- and Gifts-tab Refresh actions
  invoke it with the member's JWT (the shared `useUpSync` hook, which reloads the
  calling tab's queries once the sync returns); an hourly `pg_cron` job
  (`up-sync-hourly`) calls it through `pg_net` with the service-role key as a
  backstop. The schedule reads its
  invocation URL/key from Vault at run time and is guarded on both extensions, so
  it no-ops where they are absent. Sync writes go through the
  `upsert_up_accounts` RPC, which upserts each account's identity (dedupe on
  `(source, external_id)`) and its balance (on `account_id`) in one transaction.
- **Gift-category transactions** — after the account pass, `up-sync` polls each
  member's `gifts-and-charity` transactions and settles them through the
  `sync_up_gift_transactions` RPC (one call per member, over that member's own
  accounts), which upserts the window, holds a linked `gift_purchase` to its
  transaction's amount, and prunes the candidates Up no longer reports in the
  category. It rescans a fixed 365-day trailing window every run rather than
  advancing a cursor: Up exposes no `updatedAt` and fires no event when someone
  recategorises a transaction in the app, which is how most gift spend gets
  categorised, so only a rescan sees it. Ageing out of the window is not deletion
  — the prune is bounded by the same window — so an older candidate simply stops
  being refreshed. Only this one Up category is ingested; the synced row records
  it in `transactions.external_category`, and `category_id` (the household's own
  taxonomy) stays null. A general ledger is a later phase
  ([`up-ledger-sync.md`](up-ledger-sync.md)).
- A goal links to a synced saver via `savings_goal.linked_account_id`; a linked
  goal's current balance comes from that account's balance in `account_balance`
  (read via the `accounts_with_balance` view).
- Each member links their own token; accounts are attributed to that member
  (joint accounts left owner-null) in the shared household ledger.
- Reference: <https://developer.up.com.au/>

### Push notifications

The installed PWA is the primary device, so alerts go out over Web Push (RFC 8291
payload encryption, RFC 8292 VAPID auth) — no third-party push vendor, no native
app. The infrastructure is a subscription store, a key endpoint, and a send path:

- A member opts each device in separately. The service worker's `PushManager`
  mints a subscription; the PWA stores its endpoint and two keys in
  `push_subscription`, upserting on the endpoint so a re-subscribe refreshes the
  row rather than adding one. A subscription is readable and deletable only by
  the member whose device it is (see *Security*).
- `push-key` returns the VAPID public key for
  `pushManager.subscribe({ applicationServerKey })`. Serving it beats baking it
  into the build: rotating the keypair is then a Vault change with no rebuild.
  Unset secrets answer `503`, as `push-test` does, so no caller subscribes with a
  key that is not there.
- `push-test` fires a test notification to every device the caller has opted in,
  so the whole chain can be verified. It signs an ES256 VAPID JWT and encrypts an
  aes128gcm payload per device via `@negrel/webpush` (WebCrypto only, pinned in
  `supabase/functions/deno.lock`), attempts every device independently, prunes the
  rows a push service reports `404`/`410` for, and answers
  `{ devices, sent, pruned, failed }`. Any other failure leaves the row alone —
  a 5xx is transient, not an unsubscribe.
- The payload is `{ title, body, url }`; the service worker navigates to `url` on
  `notificationclick`.
- **Not built:** anything that decides *when* to notify. There is no scheduled
  evaluation pass and no buffer / goal / expiry trigger — a send happens only
  when a member asks for a test. Those triggers are the follow-on slice
  ([`roadmap.md`](roadmap.md)).
- VAPID setup and rotation, and the iOS install/version requirements, are in
  [`operations.md`](operations.md#web-push-vapid-keypair-setup).

## Security

- **RLS is the security boundary.** Policies grant access when `auth.uid()` maps
  to a member of the row's household; joint vs owner-scoped rows handled in
  policy. Balances live in `account_balance` (split out of the identity table so
  the account surfaces need no SECURITY DEFINER view) and, with `transactions`,
  add per-account balance privacy on top: a member sees a balance and its
  transactions only for shared, own, or household super accounts, gated by
  `visible_balance_account_ids()`. A transaction the household has claimed as a
  gift for that member is withheld from them on top of the account gate
  (`hidden_gift_transaction_ids_for_current_member()`), so no account is the wrong
  one to buy a surprise from. A co-member's spending account is exposed by
  name (no balance) through the `account_directory` view; both it and
  `accounts_with_balance` are plain invoker views (`security_invoker = on`), so no
  view reads past the caller's RLS. Tested deliberately (pgTAP / integration
  tests), not by inspection.
- **Push subscriptions are per-member, not per-household.** A push endpoint is a
  bearer capability to make someone's phone buzz, so `push_subscription` is the
  one table where household membership grants nothing: per-command policies gate
  select/insert/update/delete on `current_member_ids()`, and an upsert on a
  co-member's endpoint is refused rather than silently reassigning their device.
  `service_role` holds only `select` (to send) and `delete` (to prune dead
  endpoints).
- **Storage is gated by the same membership check.** Every bucket is private and
  every object key starts with the owning `<household_id>`, so a
  `for all to authenticated` policy on `storage.objects` matching that first path
  segment against `household_ids_for_current_user()` is the whole boundary — no
  signed-URL brokering and no service-role proxy. Payslips and receipts are
  sensitive documents, and household membership, not individual authorship, is
  what protects them.
- **Every function pins an empty search path.** `set search_path = ''` on every
  function in the schema forces each body to schema-qualify what it names, so no
  reference can be shadowed by a relation, type, or operator planted in a schema
  earlier on the caller's path — a privilege-escalation gate for the SECURITY
  DEFINER functions, defence in depth for the invoker triggers. The RLS suite
  asserts it across `pg_proc` rather than per function.
- Up tokens and webhook secrets encrypted at rest (Vault), as are the Web Push
  VAPID keypair — read only through the service-role-only `vapid_keys()` — and the
  Anthropic API key, read only through the service-role-only
  `anthropic_api_key()`.

## Cross-cutting conventions

- **Money** — integer minor units (cents); never floats.
- **Time** — AU financial year (1 Jul – 30 Jun); store UTC, present in the
  household timezone (`Australia/…`).

## Local dev & delivery

- **Supabase CLI** runs the full stack locally in Docker; SQL migrations are
  version-controlled; TypeScript types are generated from the schema.
- Migrations auto-deploy via `.github/workflows/deploy-migrations.yml` on any
  push to `main` touching `supabase/migrations/**`; edge functions auto-deploy
  via `.github/workflows/deploy-functions.yml` on any push to `main` touching
  `supabase/functions/**` or `supabase/config.toml`. Both authenticate with the
  `SUPABASE_ACCESS_TOKEN` secret and the lockfile-pinned CLI — see
  [`operations.md`](operations.md#deployment).

## CI

Parallel GitHub Actions jobs (`.github/workflows/ci.yml`), each on its own runner
so overall wall-clock is the slowest single job, not the sum. A push supersedes
an in-flight run for the same ref (`concurrency` with `cancel-in-progress`), and
the workflow token is scoped `contents: read`:

- **check** — migration-version uniqueness (`scripts/check-migration-versions.js`,
  ahead of the install so it fails in milliseconds), then lint / format /
  typecheck / build (~49s). Not the binding constraint.
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
  then the `supabase/tests/rls/` isolation assertions. The shim
  (`setup_auth.sql`) stands in for the Supabase-only primitives the policies read
  — `auth.uid()` / `auth.jwt()` and the API roles, Vault, and Storage
  (`storage.buckets` / `storage.objects` / `storage.foldername`) — so the bucket
  policies are exercised on plain Postgres alongside the table policies.
- **functions** — Deno `fmt --check` / `lint` / `check` / `test` over
  `supabase/functions` (the edge functions live outside the pnpm workspace, with
  their own Deno harness).

A `ci-status` job `needs` all four and is the single required `CI Status` check
(squash-only, no bypass).

Each pnpm job (`check`, `test-shard`, `test`) sets up the toolchain the same way:
`actions/setup-node` installs Node, then `corepack enable` /
`corepack prepare pnpm@11.14.0 --activate` provides the pnpm version pinned in the
root `package.json` `packageManager` field — no separate `pnpm/action-setup`.
Corepack fetches that pnpm binary from the npm registry, so each job points
`COREPACK_HOME` at a `.corepack` directory (git- and prettier-ignored) that
`actions/cache`
restores keyed on the pnpm version (`corepack-<os>-pnpm-11.14.0`): on a warm cache
the binary is already present and corepack never touches the registry. On a cold
cache the `corepack prepare` activation retries a few times so a transient
registry error does not fail the run. The pnpm content-addressable store is
restored by a second `actions/cache` keyed on `pnpm-lock.yaml`, so a warm
`pnpm install --frozen-lockfile` links packages from cache rather than downloading
them. The Deno `functions` job keeps its own `setup-deno` cache.

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
`supabase/functions/deno.lock` — including the extraction model, pinned to its
dated snapshot (`claude-haiku-4-5-20251001`) so the figures a payslip yields
cannot change under the feature.
