# Operations

The concrete runbook for the deployed project: where it runs, what deploys it,
and the one-off setup each moving part needs. For the conceptual pipeline see
[`architecture.md`](architecture.md); for the RPC contracts and schema see
[`data-model.md`](data-model.md).

## Environments

- **Production app** — <https://nest.willsawyerrrr.dev>.
- **Supabase** — production project ref `dgfeittjtxjtgbretdkj`, Sydney region,
  Pro tier (no project pausing; daily backups).

## Deployment

- **Migrations** auto-deploy to prod via the GitHub → Supabase integration on
  merge to `main`. SQL migrations under `supabase/migrations/` are authoritative
  for the schema.
- **Edge functions** auto-deploy on merge via
  `.github/workflows/deploy-functions.yml`: a push to `main` touching
  `supabase/functions/**` or `supabase/config.toml` runs
  `pnpm exec supabase functions deploy --project-ref dgfeittjtxjtgbretdkj`,
  deploying every function and honouring each one's `verify_jwt` from
  `config.toml` (`up-webhook` is pinned `false`; the rest default to `true`). It
  authenticates with the `SUPABASE_ACCESS_TOKEN` GitHub Actions secret.
  - The CLI comes from the `supabase` devDependency in the root
    `package.json`, installed by `pnpm install --frozen-lockfile`, so
    `pnpm-lock.yaml` is the single source of truth for the deploying version.
    `supabase/config.toml` tracks the schema that version understands, and a CLI
    resolved any other way (`supabase/setup-cli` without an explicit `version`,
    a globally installed binary) can be older than the config's keys and rejects
    the whole file with `failed to parse config: … has invalid keys`, failing the
    deploy before a single function ships. Bumping the devDependency is what
    moves CI.
  - The workflow also takes `workflow_dispatch`, so a deploy of `main` as it
    stands can be run on demand from the Actions tab or with
    `gh workflow run "Deploy functions"` — the way to redeploy after a failed
    deploy, an access-token rotation, or a fix to the workflow itself, none of
    which touch the paths the push trigger watches. Its `deploy-functions`
    concurrency group serialises manual and push runs, queueing rather than
    cancelling.
- **Frontend** — Vercel deploys the PWA on merge to `main`; each PR gets a
  preview deployment (see [Hosting](#hosting)). Live prod may briefly trail
  `main` until the next merge triggers a deploy.

## `service_role` grants

`service_role` has NO blanket table access. Its grants are `select` on `members`
and `select`/`insert`/`update` on `accounts` (migration
`20260719050000_service_role_ledger_grants.sql`), plus the same three on
`account_balance` (`20260802000000_split_account_balance.sql`). The Up functions
read `members` and `accounts` under those grants; every write goes through a
SECURITY DEFINER RPC — the token reads, `upsert_up_accounts`, and
`sync_up_gift_transactions` — which runs as its owner, so `transactions` carries no
`service_role` grant at all. Any future server-side code touching other public
tables must add its own grants deliberately — the stance is surgical, per-feature.

## Vault secrets

Vault holds every secret that must never reach a client:

| Secret                     | Purpose                                             |
| -------------------------- | --------------------------------------------------- |
| `up_token:<member_id>`     | a member's Up personal access token                 |
| `up_sync_cron_url`         | the hourly cron's `up-sync` invocation URL          |
| `up_sync_cron_key`         | the service-role key the cron POSTs with            |
| `GITHUB_CHANGELOG_TOKEN`   | the `changelog` function's GitHub PAT (see below)   |
| `vapid_public_key`         | the Web Push VAPID public key, base64url (see below) |
| `vapid_private_key`        | the Web Push VAPID private key, base64url           |
| `vapid_subject`            | the `mailto:` contact URI the VAPID JWT carries     |

Up tokens are written/read/cleared only by the service-role-only SECURITY
DEFINER RPCs (see [`data-model.md`](data-model.md#rpcs)); the VAPID set is read
by the equally service-role-only `vapid_keys()`.

## Web Push VAPID keypair setup

`push-key` and `push-test` sign every push with a VAPID keypair (RFC 8292) held
in Vault. Nothing in the app writes it — the operator sets and rotates it by
hand, so there is no store RPC to abuse.

1. Generate a P-256 keypair in the base64url form both secrets expect:

   ```sh
   deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts
   ```

   That script prints JWKs; for the raw base64url encoding the secrets hold, use
   the Node tool instead:

   ```sh
   npx web-push generate-vapid-keys
   ```

   The public key is a base64url uncompressed P-256 point (65 bytes, so it starts
   `B`); the private key is a base64url 32-byte scalar. `push-test` rejects
   anything else before attempting a push, naming the offending secret.

2. Set the three secrets in prod:

   ```sql
   select vault.create_secret('<public-key>', 'vapid_public_key');
   select vault.create_secret('<private-key>', 'vapid_private_key');
   select vault.create_secret('mailto:you@example.com', 'vapid_subject');
   ```

   The subject must be a `mailto:` or `https:` URI — RFC 8292 requires it, and a
   push service admin uses it to reach whoever runs the application server. A
   value that is neither is refused rather than sent, because a push service
   answers a bad `sub` claim with an opaque 400.

3. Verify the chain end to end: opt a device in from the Household tab and send a
   test push. `push-test` answers `{ devices, sent, pruned, failed }`.

To rotate, `select vault.update_secret(id, '<new-key>', name, null)` for both
keys. `push-key` serves the public key rather than the PWA baking it in at build
time, so a rotation needs no rebuild — but every existing subscription was minted
against the old key and stops working, so each device must re-subscribe.

**iOS caveat.** Safari delivers Web Push only to a PWA **installed to the home
screen**, on **iOS 16.4+**. In a browser tab there is no push manager to
subscribe with. Permission is also effectively one-shot per install: once denied,
it is restored only by removing and re-adding the app.

## up-sync hourly cron (prod only)

Migration `20260719040000_up_sync_schedule.sql` schedules `up-sync-hourly`
(`0 * * * *`) via `pg_cron` + `pg_net`, reading the invocation URL and key from
Vault at run time. It is guarded on both extensions, so it is a clean no-op in CI
and local Postgres and only schedules on Supabase. To bring it up in prod:

1. The function auto-deploys via CD.
2. Set the two Vault secrets (the migration reads them at run time; rotating the
   key is a Vault change, not a re-migration):

   ```sql
   select vault.create_secret('https://dgfeittjtxjtgbretdkj.supabase.co/functions/v1/up-sync', 'up_sync_cron_url');
   select vault.create_secret('<service-role-key>', 'up_sync_cron_key');
   ```

3. Re-run the migration (or `supabase db push`) once the secrets exist so the job
   schedules. It unschedules any prior `up-sync-hourly` first, so it is safe to
   re-run; absent the secrets it leaves the job unscheduled. Verify with:

   ```sql
   select * from cron.job where jobname = 'up-sync-hourly';
   ```

## `GITHUB_CHANGELOG_TOKEN` setup

The `changelog` function reads the private repo's changelog through a
fine-grained GitHub PAT scoped to the `nest` repo with **Contents: Read** and
**Pull requests: Read**. Set it in both places:

- **Prod:** `supabase secrets set GITHUB_CHANGELOG_TOKEN=<pat> --project-ref dgfeittjtxjtgbretdkj`.
- **Local dev:** add `GITHUB_CHANGELOG_TOKEN=<pat>` to `supabase/functions/.env`.

Until the secret is set the function returns `{ configured: false, available: [],
implemented: [], inProgress: [] }` (a `200`) and the tab shows a "not configured
yet" note, so it degrades gracefully.

The client posts its build's `VITE_COMMIT_SHA` as the request body's `sha`. The
function locates that commit in the raw newest-first commit list and splits
there: that commit and older become `implemented` (so a stale/cached PWA never
advertises changes its build does not contain), while the commits newer than it
become `available` — the merged-and-deployed changes the build is missing, which
the tab surfaces with a **Reload to update** button. Both halves run through the
feat/fix/perf parse. The split runs on the raw list because the deploy commit is
often a filtered-out `chore`/`docs`/`refactor`. If the SHA is empty or not found,
`available` is empty and the full list is `implemented` (fail-open, never a blank
page and never a false update prompt); in-progress open PRs are unaffected.

**Reload to update** runs `applyLatestVersion`
(`apps/pwa/src/serviceWorkerUpdate.ts`). The service worker is registered with
`registerType: 'autoUpdate'` and `injectRegister: false`, so the generated
`sw.js` omits `skipWaiting`/`clientsClaim`: a new worker precaches the new build
and then waits indefinitely. The button's fast path exploits that — it looks the
registration up and, when `registration.waiting` exists, posts the `SKIP_WAITING`
message `sw.js` listens for, waits (up to a couple of seconds) for that worker's
`statechange` to reach `activated` — `controllerchange` is a secondary signal
because installed iOS PWAs do not reliably fire it — and reloads onto the
precache the device already holds, downloading nothing.

Any other outcome, including the activation timeout, takes the fallback: clear
the Cache Storage, unregister every service worker, then hard-reload so the next
load fetches the current bundle over the network. That path is deliberately
aggressive and is the default, because iOS evicts service workers and caches out
from under installed PWAs and WebKit has a history of serving stale precached
assets after a deploy; it always lands on the new build, where the fast path only
does so when a waiting worker proves the new build is already local.

## Auth

Supabase Google OAuth (consent screen published). The site URL and redirect
allow-list cover `nest.willsawyerrrr.dev`, `nest.vercel.app`,
`nest-*-willsawyerrrr.vercel.app` previews, and `localhost:5173`.

## Hosting

Vercel project `nest` on the Pro plan, Root Directory `apps/pwa` (Vite preset).
Prod deploys via the GitHub integration on merge to `main`; each PR gets a
preview deployment. Custom domain `nest.willsawyerrrr.dev`.
`apps/pwa/vercel.json` supplies the SPA fallback rewrite. Env vars:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The build stamps the deploy's
commit into the app: `apps/pwa/vite.config.ts` reads Vercel's
`VERCEL_GIT_COMMIT_SHA` (falling back to the local `git rev-parse HEAD`) and
exposes it via `define` as `import.meta.env.VITE_COMMIT_SHA`. The changelog uses
it as a cutoff — see below.
