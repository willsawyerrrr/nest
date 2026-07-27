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

Pure logic sits in server-free sibling modules so tests never import an
`index.ts` (which would start `Deno.serve`): `_shared/up.ts`'s `UpClient` takes an
injectable `fetch` for stubbing HTTP, `up-sync/map.ts` holds the ledger mappers,
`up-webhook/signature.ts` holds the HMAC verification, `up-connect/connect.ts`
/ `up-disconnect/disconnect.ts` hold the connect/disconnect flows with their I/O
injected so the validate-then-store ordering is tested against fakes, and
`push-key/key.ts` / `push-test/send.ts` do the same for the push flows —
`push-test/webpush.ts` is exercised against a stubbed `fetch`, so the real VAPID
signature and aes128gcm framing are asserted without a push service.

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
  `X-Up-Authenticity-Signature` HMAC-SHA256 over the raw body, and upserts
  transaction events into the ledger.
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

The per-function JWT posture lives in `config.toml`, so the "deploy all" is safe:
`up-connect`, `up-disconnect`, `up-sync`, `changelog`, `push-key`, and `push-test`
are JWT-verified (the
default) — the caller is resolved from their JWT, so a member can only touch their
own token or their own devices, and `up-sync`'s PWA Refresh carries the member's
JWT while its hourly cron presents the service-role key. `up-webhook` is the only
entry in `config.toml`, setting `verify_jwt = false` so Up can call it
unauthenticated; its HMAC signature check is the security boundary.

Serve locally against the running stack, or deploy a single function by hand:

```sh
supabase functions serve up-connect
supabase functions serve up-disconnect
supabase functions serve up-webhook
supabase functions serve up-sync

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
ES256). Both functions are JWT-verified and resolve the caller from their JWT, so
a member reaches only their own devices.

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

The crypto is `@negrel/webpush` (WebCrypto only, no npm shims), pinned in
`deno.json` and `deno.lock` like every other dependency. `push-test/webpush.ts`
supplies the two pieces the library leaves to the caller: converting the stored
base64url keypair into the JWK pair WebCrypto imports, and classifying a failure
as a dead endpoint or a transient one.

Nothing here decides _when_ to notify — there is no scheduled evaluation and no
buffer / goal / expiry trigger. A push happens only when a member asks for a test.

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
