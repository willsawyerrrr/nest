# Edge functions

Deno/TypeScript functions run by Supabase Edge Runtime. They live outside the
pnpm workspace and are formatted, linted, type-checked, and tested with the Deno
CLI, so `supabase/functions` is excluded from the root oxlint, prettier, and node
tsconfigs. `deno.json` here holds the import map, `deno fmt` options (matching the
repo's prettier style), and the task shortcuts.

## Development

Run every check from `supabase/functions` (CI runs the same as its `functions`
job):

```sh
deno fmt --check   # or `deno task fmt` to write
deno lint
deno task check    # type-checks the function entrypoints
deno task test     # runs the *_test.ts unit suites
```

Run the suite through `deno task test` rather than a bare `deno test`: the task
carries the one permission the suite needs, a named env allowlist the Anthropic
SDK requires because constructing a client reads its configuration from the
environment. The set is closed and spelled out — `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_WEBHOOK_SIGNING_KEY`, `ANTHROPIC_LOG`,
`ANTHROPIC_CUSTOM_HEADERS` — and the task adds `--no-prompt`, so a read outside it
fails the run rather than being granted at an interactive prompt.
`ANTHROPIC_API_KEY` is not among them: the key is always passed to the
constructor, so the SDK never reads it. Nothing else is granted, so the tests have
no net, file, or subprocess access. CI runs the same task, so local and CI
permissions are one definition and widening the list takes a deliberate change
here.

Pure logic sits in server-free sibling modules so tests never import an
`index.ts` (which would start `Deno.serve`): `_shared/up.ts`'s `UpClient` takes an
injectable `fetch` for stubbing HTTP, `up-sync/map.ts` holds the ledger mappers,
`up-webhook/signature.ts` holds the HMAC verification, `up-connect/connect.ts`
/ `up-disconnect/disconnect.ts` hold the connect/disconnect flows with their I/O
injected so the validate-then-store ordering is tested against fakes, and
`push-key/key.ts` / `push-test/send.ts` do the same for the push flows, and
`_shared/webpush.ts` — the VAPID-sign + aes128gcm + POST + 404/410 send path
that `push-test` and `notify-eval` share — is exercised against a stubbed
`fetch`, so the real VAPID signature and aes128gcm framing are asserted without
a push service. On the same
pattern, `_shared/money.ts` holds the cents/date conversion shared by both
document-reading functions, `payslip-extract/{fields,extract}.ts` and
`deduction-extract/{fields,extract}.ts` hold their own field shaping and
extraction flow, and each function's `model.ts` takes an injectable `fetch` the
same way `UpClient` does, so the Anthropic request is asserted against a stub.

## Up Bank sync

The Up integration uses a per-member personal access token and near-real-time
webhooks, with a scheduled poll as a backstop.

- **`_shared/up.ts`** — typed Up API client (bearer auth) for pinging the API
  and listing accounts and transactions.
- **`up-connect`** — JWT-verified. Resolves the caller's member from the JWT
  (never the body), validates the posted `{ token }` with `UpClient.ping()`, and
  on success stores it encrypted in Vault via the service-role-only
  `store_up_token` RPC. The token is never returned to the client.
- **`up-disconnect`** — JWT-verified. Resolves the caller's member from the JWT
  and clears their Vault secret via the service-role-only `clear_up_token` RPC.
- **`up-webhook`** — receives Up webhook deliveries, verifies the
  `X-Up-Authenticity-Signature` HMAC-SHA256 over the raw body, and switches on
  the event type. Persisting transactions is deferred: the transaction branch is
  a `TODO` that returns `200` without a write, and gift-category ingestion runs
  on the `up-sync` poll instead, because Up raises no event when a transaction is
  recategorised (see
  [`../../docs/up-ledger-sync.md`](../../docs/up-ledger-sync.md)).
- **`up-sync`** — manual/scheduled poll that reads each member's token, fetches
  from Up, and upserts (deduping on `external_id`). JWT-verified-capable and
  scoped by caller: a member's Refresh from the PWA carries their JWT and the run
  is scoped to that member's household (`resolveCaller` → household id); the
  hourly cron presents the service-role key with no user and syncs every
  connected member. The token is read server-side only, via the service-role
  Vault RPC. The caller-scoping decision is the pure `membersToSync` in
  `up-sync/sync.ts` (household-scoped vs all), unit-tested against fakes.

### Secrets

Never exposed to clients; held server-side only.

- **Up personal access token** — one per member, stored encrypted in Supabase
  Vault under the name `up_token:<member_id>`. It is written by `store_up_token`
  and read only by `up_token_for_member` — SECURITY DEFINER RPCs granted to
  `service_role` alone, so no client can read it. Members see a boolean status
  (`members.up_connected_at`), never the token. `up-sync` reads it with a
  service-role client.
- **Webhook secret** (`UP_WEBHOOK_SECRET`) — returned once when the webhook is
  registered with Up; used to verify delivery signatures.
- **Service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) and **`SUPABASE_URL`** —
  injected by the runtime; used by `up-sync` to bypass RLS for trusted writes.

Set local secrets in `supabase/functions/.env` (git-ignored) and deployed
secrets with `supabase secrets set`.

### Deploy & serve

All functions auto-deploy to prod on merge to `main`: the
`.github/workflows/deploy-functions.yml` workflow runs
`supabase functions deploy --project-ref dgfeittjtxjtgbretdkj` whenever a push to
`main` touches `supabase/functions/**` or `supabase/config.toml`. The deploy
authenticates with the `SUPABASE_ACCESS_TOKEN` GitHub Actions secret; if that
Supabase access token is rotated, update the secret or the deploy fails.

Bundling happens in a container, so the deploy step retries a failure that reports
`failed to bundle function: exit 125` — Docker could not start the bundler — while
failing at once on anything the CLI says about the sources. Its last step then runs
`pnpm check:function-drift`, which fails the run if any function here is missing
from prod, not serving, or older than the sources its bundle carries;
`.github/workflows/check-function-drift.yml` runs the same check every six hours.
See [`../../docs/operations.md`](../../docs/operations.md#deployment) for what each
side compares and why a function is dated by its bundle inputs rather than its
directory.

The per-function JWT posture lives in `config.toml`, so the "deploy all" is safe:
`up-connect`, `up-disconnect`, `up-sync`, `changelog`, `push-key`, `push-test`,
`payslip-extract`, `deduction-extract`, `share-create`, `intent-summary`,
`goal-progress`, and `notify-eval` are JWT-verified (the default, so they carry
no `config.toml` entry) — the caller is resolved from their JWT, so a member can
only touch their own token, their own devices, files in their own household,
their own household's share, and their own household's buffer and goals;
`up-sync`'s PWA Refresh carries the member's JWT while its hourly cron presents
the service-role key, and `notify-eval` is cron-only — the gateway verifies the
bearer and the handler admits nothing but a `service_role` one. `up-webhook`,
`eofy-share`, `eofy-share-file`, and `calendar-ics` are the `config.toml` entries
setting `verify_jwt = false`: Up calls the first unauthenticated (its HMAC
signature check is the security boundary), a tax agent opening a shared EOFY link
carries no Supabase session at all (their `share_grant` bearer token, resolved by
`_shared/shareGrant.ts`, is theirs), and a calendar app subscribed to the `.ics`
feed carries only its `calendar_feed` token (resolved by
`_shared/calendarFeed.ts`).

Serve locally against the running stack, or deploy a single function by hand:

```sh
supabase functions serve up-connect
supabase functions serve up-disconnect
supabase functions serve up-webhook
supabase functions serve up-sync
supabase functions serve payslip-extract
supabase functions serve deduction-extract
supabase functions serve eofy-share
supabase functions serve eofy-share-file
supabase functions serve share-create
supabase functions serve calendar-ics
supabase functions serve changelog
supabase functions serve push-key
supabase functions serve push-test
supabase functions serve notify-eval
supabase functions serve intent-summary
supabase functions serve goal-progress

supabase functions deploy up-connect --project-ref dgfeittjtxjtgbretdkj
```

Register the webhook with Up (pointing at the deployed `up-webhook` URL) via the
Up API.

### Hourly sync schedule (prod)

`up-sync` is scheduled hourly by `20260719040000_up_sync_schedule.sql` using
`pg_cron` + `pg_net`. The migration is guarded on both extensions being
available, so it is a clean no-op on plain Postgres (CI, local) and only
schedules on Supabase. The scheduled command reads the invocation URL and key
from Vault at run time, so nothing secret is baked into the migration. To
activate it in prod, deploy `up-sync` and set two Vault secrets, then re-run the
migration:

- `up_sync_cron_url` — `https://<project-ref>.supabase.co/functions/v1/up-sync`
- `up_sync_cron_key` — the project service-role key

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/up-sync', 'up_sync_cron_url');
select vault.create_secret('<service-role-key>', 'up_sync_cron_key');
```

The job (`up-sync-hourly`) is idempotent across re-runs (it unschedules any prior
job first) and is skipped when the secrets are absent. Verify with
`select * from cron.job where jobname = 'up-sync-hourly';`.

### Daily notification schedule (prod)

`notify-eval` is scheduled once a day (`0 21 * * *` UTC ≈ 07:00 AEST) by
`20260905000000_notification_triggers.sql`, on the same `pg_cron` + `pg_net`
pattern and the same skip-if-absent guard. Activate it in prod by deploying
`notify-eval` and setting two Vault secrets, then re-running the migration:

- `notify_cron_url` — `https://<project-ref>.supabase.co/functions/v1/notify-eval`
- `notify_cron_key` — the project service-role key

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify-eval', 'notify_cron_url');
select vault.create_secret('<service-role-key>', 'notify_cron_key');
```

The job (`notify-eval-daily`) unschedules any prior job first and is skipped
when the secrets are absent. Verify with
`select * from cron.job where jobname = 'notify-eval-daily';`.

## Payslip extraction

`payslip-extract` reads the figures off an uploaded payslip so the member can
confirm them. **It never writes a payslip figure anywhere**: it returns the fields
it read, the manual entry form pre-fills from them, and the member's own save is
what persists. A wrong tax figure saved silently is worse than no extraction at
all, so there is no write path in the function — no table, no RPC, no Storage
write — which also means a failure at any step can leave nothing half-written.

- **Request** — `POST { "path": "<household_id>/…" }`, the object path of a file
  the client has *already* uploaded to the private `payslips` bucket (the file is
  the auditable record whether or not extraction succeeds, so it is uploaded
  first). JWT-verified: the caller is resolved to their own member and household
  from the JWT, and the path's first segment must be that household — defence in
  depth on top of Storage RLS, because the path comes from the client. The object
  is then downloaded with the service role.
- **Model** — Claude Haiku 4.5, pinned to its dated snapshot
  (`claude-haiku-4-5-20251001`) alongside the other pinned dependencies. Structure
  is forced with a tool schema rather than parsed out of prose, and every field in
  it is nullable, so a slip without super — or a figure the model cannot find —
  comes back null rather than invented. PDFs go as a `document` block, photos and
  scans as an `image` block; anything else is rejected.
- **Money** — the model reports each amount as the **literal text printed on the
  slip** (`"4,120.50"`, `"$1,234"`); `money.ts` converts it to integer cents with
  integer arithmetic on the digit strings. The model is never asked to multiply by
  100, and `parseFloat(text) * 100` is never used (it loses a cent on amounts like
  `8.29`). Text that is not unambiguously an amount yields null, never a number.
- **Response** — `{ model, fields, text, missing, unreadable }`: `fields` holds
  the column-shaped values (ISO dates, `*_cents` integers, null where
  unavailable), `text` the literal strings that were read so the form can show
  what the model saw, `missing` the fields the slip did not show, and `unreadable`
  the fields whose text could not be converted safely. A partial extraction is a
  success — the member fills the gaps.
- **Failures** — `400` bad path or empty file, `403` a path outside the caller's
  household, `404` no such object, `415` an unsupported file type, `413` a file
  past the size cap (5 MiB for an image, 20 MiB for a PDF, both sized so base64
  stays inside the Messages API's per-image and 32 MB request limits), `422` the
  model reporting the document is not a payslip — or declining to read it at all,
  which is a content problem rather than a server one — `429` an upstream rate limit,
  `502` an API error or unusable model output, `504` a timeout, and `503` with
  `{ configured: false }` when the API key is unset — an honest "the feature is
  off, enter it by hand" rather than a 500 that looks like a bug.

## Receipt extraction

`deduction-extract` reads the fields off an uploaded deduction receipt so the
member can confirm them, on the same shape as `payslip-extract`: JWT-verified,
takes an already-uploaded object path, checks the path's household prefix,
downloads with the service role, and forces a tool schema over Claude Haiku 4.5.
It **never writes a deduction anywhere** — same reasoning as payslip extraction —
and shares its money/date conversion (`_shared/money.ts`) and its Vault-held API
key (`anthropic_api_key`).

- **Request** — `POST { "path": "<household_id>/<deduction_id>/…" }`, the object
  path of a file the client has *already* uploaded to the private `receipts`
  bucket (Storage has no foreign key, so the upload can happen before the
  deduction row exists — see [`../../CLAUDE.md`](../../CLAUDE.md)'s Tax
  deductions section).
- **Fields** — a receipt states less than a payslip does, so the schema asks for
  three: `description` (the merchant/business name, or — absent one — what was
  purchased), `deduction_date` (the date of purchase, converted to ISO by the
  model as `payslip-extract` converts its dates), and `amount` (the printed TOTAL,
  never a subtotal or a single line item, reported as literal text and converted
  to cents in `_shared/money.ts`, never by the model).
- **Response** — `{ model, fields, text, missing, unreadable }`, the same shape as
  `payslip-extract`'s: `fields.description` is the read text directly (no
  conversion applies to it), `fields.deduction_date` and `fields.amount_cents`
  are the converted values, `text` carries the literal date/amount strings read,
  and `missing`/`unreadable` say which fields the receipt did not show versus
  which were read but could not be converted safely.
- **Failures** — the same taxonomy as `payslip-extract`: `400`/`403`/`404`/`415`/
  `413` on the request or file, `422` when the model reports the document is not
  a receipt (`notReceipt: true`) or declines to read it, `429` a rate limit,
  `502` an API error or unusable output, `504` a timeout, and `503` with
  `{ configured: false }` / `{ outOfCredit: true }` / `{ keyRejected: true }` for
  the three operator-fixable "reading is off" cases.

### Secret

- **`anthropic_api_key`** — one household-wide Anthropic API key, held in Vault
  and readable only by the SECURITY DEFINER `anthropic_api_key()` function
  granted to `service_role` alone (`20260812000000_anthropic_api_key.sql`), which
  each extraction function calls with its own service-role client. It is never
  returned to a client. The operator sets it by hand; see
  [`docs/operations.md`](../../docs/operations.md).

## EOFY sharing

A household shares its EOFY summary with a tax agent via a scoped, time-limited,
read-only bearer token (`share_grant` — see
[`../migrations/20260831000000_share_grant.sql`](../migrations/20260831000000_share_grant.sql)),
never a Supabase account or Google OAuth. Three functions:

- **`share-create`** — JWT-verified, called from the EOFY tab. Runs
  `create_share_grant` as the caller (their own JWT-scoped client, so
  `auth.uid()` resolves and the RPC's own household lookup applies), which
  mints a 64-hex-char token and replaces any grant the household already had.
  When `resend_api_key` is set, emails the link
  (`{PWA_APP_URL}/share/eofy/{token}`) to the recipient via the Resend API. The
  grant is minted either way — an email failure never leaves the household
  without a link — and the response's `{ token, expiresAt, emailSent }` lets
  the PWA show/copy the link as a fallback whatever `emailSent` says. Pure flow
  logic (the resolve-then-mint-then-email ordering) lives in `create.ts`,
  DI-tested against fakes.
- **`eofy-share`** — `verify_jwt = false`. Takes `POST { token }`, resolves it
  against `share_grant` (`_shared/shareGrant.ts`), and — on a service-role
  client, since the caller has no `auth.uid()` for the household's own RLS to
  match — returns the same raw rows `EofySection.tsx` loads for the
  household's own EOFY tab (inflows, tax profiles, super contributions and
  profiles, HELP debts, deductions, and payslips), scoped by hand to the
  grant's household and, where the corresponding hook is FY-scoped, its
  financial year. It also returns `savings_goal` and a minimal per-account
  balance set (`{ id, owner_member_id, balance_cents }`, rebuilt from `accounts`
  and `account_balance`) so the shared view feeds a goal's projected savings
  interest into the tax estimate the same way the household's own tab does.
  `deductionReceipts` is pre-filtered to the deductions already in scope. Data
  shaping lives in `data.ts`, DI-tested against fakes.
- **`eofy-share-file`** — `verify_jwt = false`. Takes
  `POST { token, bucket, path }` (`bucket` is `'receipts'` or `'payslips'`) and
  signs a 5-minute Storage URL for one deduction receipt or payslip document —
  shorter than the household's own hour-long signed URLs, since this is a
  lower-trust anonymous bearer. This is the feature's main new security
  surface: an anonymous bearer's token grants no blanket Storage access, only
  a signed URL for a file the scope check proves belongs to the resolved
  grant's household and financial year (the path's household-prefix check,
  then a database lookup of the receipt/payslip row itself) — the whole of the
  boundary, not a convenience on top of Storage RLS, which never matches an
  `auth.uid()`-less caller anyway. Logic lives in `file.ts`, DI-tested against
  fakes covering a path from another household, one from an out-of-scope
  financial year, and one with no matching row.

Both anonymous functions report the identical generic 401 whether a token is
malformed, matches nothing, or has expired — `_shared/shareGrant.ts` never
distinguishes "expired" from "never existed" in the response.

### Secret

- **`resend_api_key`** — the Resend API key `share-create` emails with, held
  in Vault and readable only by the SECURITY DEFINER `resend_api_key()`
  function granted to `service_role` alone
  (`20260831000000_share_grant.sql`), mirroring `anthropic_api_key()`. It is
  never returned to a client. Two plain environment variables,
  `PWA_APP_URL` and `RESEND_FROM_ADDRESS`, round out the setup — see
  [`docs/operations.md`](../../docs/operations.md#resend_api_key-and-pwa_app_url-setup-eofy-sharing).

## Calendar feed

The household's money dates are served as a subscribable iCalendar (`.ics`) feed
so members see them in whatever calendar app they already use. The reader is a
calendar server with no Supabase session, so the token in the URL is the whole
credential — the same shape EOFY sharing uses, without the expiry.

- **`calendar-ics`** — `verify_jwt = false`. Answers a `GET` (or `HEAD`) with the
  feed token as a trailing path segment (`…/calendar-ics/<token>[.ics]`) or
  `?token=`, hashes it, and looks `calendar_feed` up by `token_hash`
  (`_shared/calendarFeed.ts`). A missing, malformed, or unknown token all get an
  identical bare `404`. On a match it reads the household's `inflows`,
  `savings_goal`, and `temporary_item` rows on a service-role client (the
  subscriber has no `auth.uid()` for the household's own RLS to match) and
  renders them as all-day events over a rolling −1…+12-month window, each with a
  deterministic `UID` so a re-fetch updates an event in place. `runCalendarIcs`
  owns the flow and `events.ts` the ICS rendering, both DI-tested against fakes.
  See [`../../docs/calendar-feed.md`](../../docs/calendar-feed.md).

## Changelog ("What's new")

The in-app changelog reads recent user-facing changes from GitHub at runtime.
Because `willsawyerrrr/nest` is private, the GitHub token stays server-side and
the function proxies the API.

- **`changelog`** — JWT-verified, so only signed-in users can call it. Fetches
  merged-commit subjects on `main` and open PR titles (in progress) from the
  GitHub REST API, keeps only user-facing Conventional Commit types (feat / fix /
  perf) while excluding `ci`-scoped entries (CI/plumbing, not user-facing), and
  returns the shaped lists. It takes an optional `sha` in the request body — the
  client's build commit — and splits the raw newest-first commit list at that
  commit (prefix-matched, fail-open): that commit and older are `implemented` (so
  a stale/cached PWA never shows entries newer than its build), the commits newer
  than it are `available` (the deployed changes the running build is missing, so
  the tab can offer a reload to the latest version); open PRs are unaffected. The
  parsing, split, and filtering are the pure `parseChangelogSubject` /
  `splitCommitsAtSha` / `runChangelog` in `changelog/changelog.ts` (HTTP
  injected), unit-tested against a stubbed `fetch`. A GitHub failure surfaces as a
  `502`.

### Secret

- **`GITHUB_CHANGELOG_TOKEN`** — a fine-grained GitHub PAT scoped to the `nest`
  repo with **Contents: Read** and **Pull requests: Read**. When it is unset the
  function returns `{ configured: false, available: [], implemented: [],
  inProgress: [] }` so the UI shows a "not configured yet" note instead of an
  error. Set it locally in
  `supabase/functions/.env` and in prod with
  `supabase secrets set GITHUB_CHANGELOG_TOKEN=<pat>`.

## Web Push

Alerts reach the installed PWA over Web Push — payload encryption per
[RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) (aes128gcm) and application
server auth per [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) (a VAPID JWT,
ES256). `push-key` and `push-test` are JWT-verified and resolve the caller from
their JWT, so a member reaches only their own devices; `notify-eval` is the
daily cron that decides when to notify.

- **`push-key`** — returns `{ publicKey }`, the VAPID public key the client passes
  to `pushManager.subscribe({ applicationServerKey })`. Served rather than baked
  into the build so rotating the keypair is a Vault change with no rebuild. When
  the secrets are unset it answers `503 { error }`, never a null key a caller
  might subscribe with unchecked.
- **`push-test`** — POST. Loads the caller's own `push_subscription` rows and
  sends a test notification to each, answering
  `{ devices, sent, pruned, failed }`. Every device is attempted independently, so
  one failing endpoint neither aborts the others nor loses the summary. A `404` or
  `410 Gone` means the device unsubscribed, so that row is deleted; every other
  failure leaves the row alone for the next attempt. The payload is
  `{ title, body, url }`, with `url` (`/household`) the target for the service
  worker's `notificationclick`.

- **`notify-eval`** — the once-daily evaluator that decides _when_ to notify.
  A `pg_cron` schedule (`20260905000000_notification_triggers.sql`) POSTs it
  with the service-role key; the default JWT posture verifies that key and the
  handler rejects anything but a `service_role` bearer, so only the cron starts
  a run. With a service-role client it reads every household's plan, checks
  four conditions against today's data with the pure `@nest/plan` / `@nest/tax`
  engines —

  - **buffer_negative** — the fortnightly buffer (`summarise().afterSaving`) is
    below zero. Dedupe key: the financial year, re-notified after 14 days.
  - **goal_eta_slipped** — a dated savings goal's `projectGoal()` completion is
    past its `target_date` (or unreachable). Dedupe key: `<goal_id>:<target_date>`.
  - **temporary_item_expiring** — a `temporary_item.target_date` is within 14
    days. Dedupe key: the item id.
  - **fy_boundary** — within 14 days of 30 June. Dedupe key: the financial year.

  — and for each member with a device, the trigger left on
  (`notification_preference`), and no matching `notification_log` row in the
  dedupe window, sends `{ title, body, url }` via `_shared/webpush.ts` and
  appends a `notification_log` row. A row is written only once a device took
  the push, so a run where every endpoint failed transiently is retried the
  next day. Dead endpoints (`404`/`410`) are pruned. The decision logic is the
  pure, DI-tested `notify-eval/eval.ts`; its `buffer_negative` figure is the
  shared household buffer (see [Household buffer](#household-buffer)).

`@nest/plan` and `@nest/tax` reach the edge runtime through
`_shared/vendor/`. The Supabase CLI bundles each function inside a container
that sees only `supabase/functions/`, so an import that reaches `../../packages`
fails the deploy. `scripts/vendor-edge-packages.js` (`pnpm vendor:edge`) copies
`packages/{plan,tax}/src` verbatim into `_shared/vendor/`, `deno.json` maps the
two specifiers there, and CI's `pnpm check:vendor-edge` fails when the copy has
drifted from the packages, which stay the single source of truth. `deno fmt`
and `deno lint` skip the vendored tree; `deno check` still type-checks it.

The crypto is `@negrel/webpush` (WebCrypto only, no npm shims), pinned in
`deno.json` and `deno.lock` like every other dependency. `_shared/webpush.ts` is
the send path both `push-test` and `notify-eval` call: `createPushSender` binds
one application server to the Vault keypair and returns a per-device sender, and
the module supplies the two pieces the library leaves to the caller — converting
the stored base64url keypair into the JWK pair WebCrypto imports, and classifying
a failure as a dead endpoint or a transient one.

Deciding **per-member, per-timezone** when the daily run fires is a follow-up;
the schedule is one fixed UTC hour (≈ morning AEST) for every household.

### Secrets

The VAPID keypair lives in Vault, read only by the service-role-only
`vapid_keys()` RPC — one call returning all three, because a send needs all three
at once. There is no store RPC: the operator sets and rotates them by hand.

- **`vapid_public_key`** — base64url uncompressed P-256 point (65 bytes).
- **`vapid_private_key`** — base64url 32-byte P-256 scalar.
- **`vapid_subject`** — a `mailto:` (or `https:`) contact URI for the push
  service's admins; RFC 8292 requires it, and a malformed one is refused before
  any push is attempted.

Generation, the exact `vault.create_secret` calls, rotation, and the iOS
install/version requirements are in
[`docs/operations.md`](../../docs/operations.md#web-push-vapid-keypair-setup).

## Household buffer

The PWA Summary's on-screen "fortnightly after saving" figure — the row shaping,
the tax estimate, and `summariseHouseholdFromRows`'s whole-year + active-now
double reconciliation — is the `@nest/household` package, imported here as the
vendored copy under `_shared/vendor/household/` and by the PWA directly, so there
is one implementation. The tax and plan math itself stays in `@nest/tax` /
`@nest/plan`. `_shared/householdBuffer.ts` is the remaining edge-only glue:
`loadBudgetSummaryBundle` and `readHouseholdTable`, the service-role row load both
consumers wire in, plus `toSaverRows` for the `accounts` / `account_balance`
split. The breakdown- and gift-derived budget lines are read straight from
`budget_line`: the `reconcile_derived_lines` triggers keep their annual
`amount_cents` canonical, so unlike the PWA (which re-derives them) the buffer
trusts the row and reads none of the breakdown or gift tables. `notify-eval`'s
`buffer_negative` trigger and `intent-summary` both call it, so the Siri figure
and the app's Summary never disagree; `_shared/householdBuffer_parity_test.ts`
runs the package's golden fixtures through the vendored copy to hold the two in
step.

- **`intent-summary`** — POST, no body, `Bearer` Supabase access token.
  JWT-verified: `_shared/caller.ts` resolves the caller's member, then one
  `members` read gives their household. The rows load on a service-role client
  (the buffer reads across the whole household, past the per-account
  balance-privacy boundary) and the response is
  `{ fortnightlyAfterSavingCents: number }` — the exact on-screen Summary buffer.
  The pure flow is `intent-summary/run.ts` (`runIntentSummary`), DI-tested
  against fakes. Serves the iOS App Intent behind "what's my Nest buffer".
- **`goal-progress`** — POST, no body, `Bearer` Supabase access token.
  JWT-verified, the same caller → household resolution as `intent-summary`. Loads
  `savings_goal` plus the household's synced Up savers on a service-role client,
  resolves each goal's saved amount (a linked saver's synced balance where it
  links one, else `current_balance_cents`), and answers
  `{ goals: { name, savedCents, targetCents }[], totalSavedCents, totalTargetCents }`
  with `goals` ordered dated-first. The pure shaping and flow are
  `goal-progress/run.ts` (`shapeGoalProgress` / `runGoalProgress`), DI-tested.
  Serves the iOS App Intent behind "how are my Nest savings goals".
