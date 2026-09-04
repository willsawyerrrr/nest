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
  `payslip-extract` and `deduction-extract` (read the figures off an uploaded
  payslip or deduction receipt with Claude Haiku 4.5 so the member can confirm
  them: each takes the Storage object path of an already-uploaded file, checks
  that path's household prefix against the caller's own household, forces a
  nullable tool schema so an absent figure comes back null rather than
  invented, converts each amount from the literal printed text to integer
  cents in TypeScript, and **writes no figure** — the member confirms the
  pre-filled form and their own save is what persists; `deduction-extract`
  shares its money/date conversion with `payslip-extract` via
  `_shared/money.ts`). The Up functions hold Up
  tokens server-side (via Vault); `changelog` holds a GitHub PAT server-side; the
  push functions hold the VAPID keypair; `payslip-extract` and
  `deduction-extract` read the same Vault-held Anthropic key. All are
  JWT-verified except `up-webhook`
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
  value edited on one tab propagates live to every tab that reads it. Planning
  mode layers a per-device, per-household `localStorage` sandbox over `inflows`,
  `budget_line`, and `savings_goal` inside the same factory, so every projection
  recomputes from the edited rows with nothing written to Postgres — see
  [`planning-mode.md`](planning-mode.md).
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
  Up's three account types map to `account_type`: `TRANSACTIONAL → transaction`,
  `SAVER → savings`, `HOME_LOAN → home_loan`. A home loan's balance feeds net
  worth as a liability (the amount owed) and it is excluded from the routing
  surface — see [`super-and-net-worth.md`](super-and-net-worth.md#net-worth-tab).
- **Account reconcile** — after the upsert, for a member whose token read
  succeeded, the ids that token returned are authoritative for that member's
  individually-owned `source = 'up'` accounts, and `reconcile_up_accounts`
  (SECURITY DEFINER, `service_role` only — `service_role` has no delete on
  `accounts`) settles the rest: an account the token no longer reports is
  deleted when nothing references it (its `account_balance` cascades) or kept
  and stamped `accounts.deleted_from_source_at` when a savings goal, a budget
  line's funding account, the household pay account, or a member's super link
  still holds it; an account that reappears in a later sync has the stamp
  cleared. The PWA shows a stamped account as "deleted in Up" with a
  Remove-from-Nest action (a direct RLS delete) once its dependency is cleared.
  A failed or absent token read reconciles nothing.
- **Joint account reconcile** — a joint account (owned by neither member)
  surfaces through every partner's token, so one member's token dropping it is
  no proof it was deleted in Up. After the member loop, `up-sync` reconciles
  each household's joint (`owner_member_id is null`) `source = 'up'` accounts
  once, through `reconcile_joint_up_accounts` (the joint twin of the RPC above,
  same three rules keyed on `owner_member_id is null`, same references checked,
  SECURITY DEFINER, `service_role` only). It runs for a household only when
  every connected member in scope synced with a readable token this run, and
  against the union of the Up account ids those members' tokens returned — so a
  joint account is deleted or flagged only when it is absent from every read
  that should have seen it. A household with a member whose token was unreadable
  or unsynced is left until a run that covers all of it; a single-member
  household reconciles against just that member's set, since nothing else can
  see the joint account. A failure in it costs only that household's joint
  reconcile.
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
- `notify-eval` decides *when* to notify. A `pg_cron` job POSTs it once a day
  (one fixed UTC hour, ≈ morning AEST) with the service-role key; it reads every
  household's plan with a service-role client, checks four conditions against
  today's data with the pure `@nest/plan` / `@nest/tax` engines, and pushes to
  each member with a device who has not turned that trigger off — a per-trigger
  toggle in the Household screen's Notifications card, `notification_preference`,
  absent ⇒ on — and has no matching `notification_log` row in the dedupe window:
  - **buffer_negative** — `summarise().afterSaving.fortnightlyCents` is below
    zero. Dedupe: the financial year, re-sent after 14 days.
  - **goal_eta_slipped** — a dated goal's `projectGoal()` completion is past its
    `target_date` or unreachable. Dedupe: `<goal_id>:<target_date>`.
  - **temporary_item_expiring** — a `temporary_item.target_date` within 14 days.
    Dedupe: the item id.
  - **fy_boundary** — within 14 days of 30 June. Dedupe: the financial year.

  It appends a `notification_log` row only once a device took the push, so a
  transient total failure is retried next day, and prunes `404`/`410` endpoints.
  The decision logic is the pure, DI-tested `notify-eval/eval.ts`. Deposit-landed
  and bill-due triggers need ingestion and are out of scope; per-member,
  per-timezone scheduling is a follow-up.
- VAPID setup and rotation, and the iOS install/version requirements, are in
  [`operations.md`](operations.md#web-push-vapid-keypair-setup).

### Calendar feed

The household's money dates belong in whatever calendar its members already
keep, so `calendar-ics` publishes them as a read-only iCalendar (RFC 5545) feed
a calendar app subscribes to by URL — no Google Calendar write scope and no
consent-screen change. It is the anonymous-bearer pattern EOFY sharing
established (see *Security*), applied to a feed rather than a page:

- `calendar_feed` holds at most one row per household (`household_id` is the
  primary key) with `token_hash` — `sha256(token)` hex, never the plaintext.
  `create_calendar_feed_token()` mints (or replaces) the token and returns it
  once; `revoke_calendar_feed_token()` deletes the row. Both are SECURITY
  DEFINER, granted to `authenticated`, and a column-level `select` grant
  withholds `token_hash` from the household's own read. Unlike `share_grant`
  there is no expiry — a calendar subscription refreshes indefinitely, and the
  household ends a feed by regenerating (which replaces the token) or revoking.
- `calendar-ics` runs `verify_jwt = false` — a subscribing client carries no
  session — and takes the token from a trailing path segment or `?token=`. It
  hashes the token (`_shared/calendarFeed.ts`), looks `calendar_feed` up by
  `token_hash` with a service-role client, and answers a bare `404` for a
  missing, malformed, or unknown token alike, so a guessed token learns nothing.
- Events are derived by hand from the household's own rows, scoped to the
  resolved feed's household, over a rolling −1-month … +12-month window:
  - each **recurring inflow**'s expected deposits, stepped from its pay cadence
    (`pay_schedule` + `pay_interval_count`, else `schedule` + `interval_count`),
    honouring `starts_on` / `ends_on`; an inflow with no usable cadence is
    skipped, and one anchored on no `starts_on` is stepped from a fixed epoch so
    its dates do not move between fetches;
  - each **one-off inflow** on its `paid_on`;
  - each dated **savings goal** and **temporary item** on its target date;
  - the **30 June / 1 July** financial-year boundary for every year the window
    spans.
- Every event is all-day (`DTSTART;VALUE=DATE`) with a stable
  `<kind>-<rowId>-<date>@nest` `UID`, so a re-fetch updates an event in place
  rather than duplicating it. Derivation and the small inline ICS serialiser
  (text escaping + 75-octet line folding, no dependency) are the pure,
  DI-tested `calendar-ics/events.ts`; `feed.ts` is the token-before-read flow
  and `index.ts` wires the service-role reads. The Household screen's
  *Calendar feed* card generates, shows once, regenerates, and revokes the URL.
- `service_role` `select` grants for the read are in
  [`operations.md`](operations.md#service_role-grants).

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
- **Push subscriptions and notification choices are per-member, not
  per-household.** A push endpoint is a bearer capability to make someone's phone
  buzz, so `push_subscription` is the one table where household membership grants
  nothing: per-command policies gate select/insert/update/delete on
  `current_member_ids()`, and an upsert on a co-member's endpoint is refused
  rather than silently reassigning their device. `notification_preference` — a
  member's on/off choice per trigger — draws the same boundary. `service_role`
  holds `select` on both plus `delete` on `push_subscription` (to prune dead
  endpoints). `notification_log`, the evaluator's dedupe ledger, is
  `service_role`-only (`select`/`insert`) with no `authenticated` grant at all —
  a member sees that a notification arrived, never the ledger of which devices
  got what.
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
- **A scoped bearer token is a narrower boundary than RLS, for a caller RLS
  cannot reach at all.** `share_grant` (EOFY sharing) is the first table
  designed for a reader with no `auth.uid()` — a tax agent holding a link,
  never a Supabase session — so the household's own `household_id in
  (select household_ids_for_current_user())` policies would refuse it
  outright even if the anonymous functions tried to read through them. The
  `eofy-share` / `eofy-share-file` functions therefore run
  `verify_jwt = false` (the same posture `up-webhook` uses for Up's
  unauthenticated deliveries) and hash the caller's bearer token
  (`_shared/shareGrant.ts`) to look `share_grant` up by `token_hash` with a
  service-role client, deliberately bypassing RLS the same way a SECURITY
  DEFINER function does — the token match is the security check, standing in
  for `auth.uid()`. Every table the shared view then reads is scoped **by
  hand** to the resolved grant's household (and financial year, where the
  authenticated hook is FY-scoped) inside the function itself, since no
  RLS policy is doing that scoping for it. `eofy-share-file`'s own database
  lookup — confirming a requested Storage path genuinely belongs to a
  deduction or payslip in that same household and financial year — is the
  same idiom applied to file access: Storage's own membership policy never
  matches an `auth.uid()`-less caller either, so the function's scope check
  is the entire boundary, not a convenience layered on Storage RLS. The
  credential itself never round-trips as plaintext: `share_grant` stores
  only `sha256(token)`, and even the household's own read of its live share
  (`select` under ordinary RLS) is denied `token_hash` by a column-level
  grant, so the one place the plaintext ever exists is the moment
  `create_share_grant` returns it. `calendar_feed` (the calendar feed) is the
  same shape for a subscribing calendar client — `verify_jwt = false`,
  `token_hash` resolved by a service-role client, `token_hash` withheld from the
  household's own read — differing only in that it carries no expiry and every
  invalid token gets an identical bare `404`.

## Cross-cutting conventions

- **Money** — integer minor units (cents); never floats.
- **Time** — AU financial year (1 Jul – 30 Jun); store UTC, present in the
  household timezone (`Australia/…`).

## Local dev & delivery

- **Supabase CLI** runs the full stack locally in Docker; SQL migrations are
  version-controlled. `pnpm dev` (`scripts/dev-app.js`) brings the stack up and
  applies pending migrations; `pnpm dev --reset` replays every migration from a
  dropped database, for when the local schema has drifted from
  `supabase/migrations/`.
- **`apps/pwa/src/lib/database.types.ts`** is generated from the schema by
  `pnpm db:types` (`scripts/gen-db-types.js`), which runs
  `supabase gen types typescript` against the local stack, trims the telemetry
  line the CLI sometimes trails, and formats the result. It is committed, and
  the `rls` CI job regenerates it against a Postgres with every migration applied
  and fails on any difference (`pnpm check:types`), so a hand-edit that a
  build cannot catch does not reach `main`.
- Migrations auto-deploy via `.github/workflows/deploy-migrations.yml` on any
  push to `main` touching `supabase/migrations/**`; edge functions auto-deploy
  via `.github/workflows/deploy-functions.yml` on any push to `main` touching
  `supabase/functions/**` or `supabase/config.toml`. Both authenticate with the
  `SUPABASE_ACCESS_TOKEN` secret and the lockfile-pinned CLI — see
  [`operations.md`](operations.md#deployment).
- `.github/workflows/check-migration-drift.yml` and
  `.github/workflows/check-function-drift.yml` close the loop on the two deploys:
  on a six-hourly schedule (and on `workflow_dispatch`) they fail if prod has not
  applied every migration in `supabase/migrations/`, and if any function in
  `supabase/functions/` is missing from prod, not serving, or older than the
  sources its bundle carries — whether or not a push ever triggered a deploy for
  them. Each deploy workflow runs its own check as a post-push assertion, and the
  function deploy retries a bundle step that failed because Docker could not
  start a container — see [`operations.md`](operations.md#deployment).

## CI

Parallel GitHub Actions jobs (`.github/workflows/ci.yml`), each on its own runner
so overall wall-clock is the slowest single job, not the sum. A push supersedes
an in-flight run for the same ref (`concurrency` with `cancel-in-progress`), and
the workflow token is scoped `contents: read`:

- **check** — migration-version uniqueness (`scripts/check-migration-versions.js`)
  and edge-vendor sync (`scripts/vendor-edge-packages.js --check`, asserting
  `supabase/functions/_shared/vendor/` still matches `packages/{plan,tax}/src`),
  both ahead of the install so they fail in milliseconds, then lint / format /
  typecheck / build (~49s). Not the binding constraint.
- **test** — the Vitest workspace, sharded across six parallel runners with V8
  coverage. A `test-shard` matrix job runs
  `vitest run --shard=N/6 --coverage --reporter=default --reporter=blob` on six
  runners (each covering a sixth of the files, the union running every test) and
  uploads its blob report; a `test` job downloads all six and merges them with
  `vitest run --merge-reports --coverage`, failing if a package drops below its
  threshold: `@nest/plan` and `@nest/tax` at 100% on every metric, `apps/pwa` at
  100% statements / functions / lines with a branch floor (currently 93). The
  thresholds evaluate over the merged coverage of the whole suite; a shard sets
  `VITEST_SKIP_COVERAGE_THRESHOLDS` so its partial coverage does not fail the
  check. The `test` job `needs` the shards, so the required-check name stays green
  only when all six pass. Alongside the packages and the app, the repo scripts
  carry their own Vitest project (`scripts/vitest.config.js`) so the drift checks'
  comparison logic is exercised against fixtures; it sits outside the coverage
  thresholds, which measure the money-critical packages and the app. The shard
  pairs the `default` reporter with `blob` to sidestep a Vitest coverage race
  that fails a shard with every test green (the `ci.yml` comment has the
  detail); `blob` stays for the merge.
- **rls** — Postgres service; applies the auth shim, every migration in order,
  then the `supabase/tests/rls/` isolation assertions, then regenerates
  `database.types.ts` against that schema and fails on any diff
  (`scripts/gen-db-types.js --check`). The shim
  (`setup_auth.sql`) stands in for the Supabase-only primitives the policies read
  — `auth.uid()` / `auth.jwt()` and the API roles, Vault, Storage
  (`storage.buckets` / `storage.objects` / `storage.foldername`), and the
  `graphql_public.graphql()` function `gen types` reproduces — so the bucket
  policies are exercised on plain Postgres alongside the table policies and the
  generated types match what `pnpm db:types` produces from the local stack. The
  job carries the pnpm toolchain (Node, the store cache) for the type check; the
  isolation assertions themselves are still plain `psql`.
- **functions** — Deno `fmt --check` / `lint` / `check` / `test` over
  `supabase/functions` (the edge functions live outside the pnpm workspace, with
  their own Deno harness).

A `ci-status` job `needs` all four and is the single required `CI Status` check
(squash-only, no bypass).

`check`'s migration assertion is the half of the migration contract a pull
request can prove: the directory's versions are unique. The other half — prod
having applied them — needs a credential and a network round trip, so it lives in
`check-migration-drift.yml` on a schedule rather than in `ci.yml`, outside the
sub-minute budget and off the required-check path. It is nonetheless quick
(checkout, pnpm install, `link`, one query). The function contract splits the same
way: `functions` proves the sources are well formed, and
`check-function-drift.yml` — a credentialed read of the project — proves prod is
running them.

Each pnpm job (`check`, `test-shard`, `test`, `rls`) sets up the toolchain the same way:
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
