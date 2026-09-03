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

- **Migrations** auto-deploy on merge via
  `.github/workflows/deploy-migrations.yml`: a push to `main` touching
  `supabase/migrations/**` links the production project and runs
  `pnpm exec supabase db push --linked --include-all --yes`. SQL migrations
  under `supabase/migrations/` are authoritative for the schema. It
  authenticates with the same `SUPABASE_ACCESS_TOKEN` GitHub Actions secret and
  the same lockfile-pinned CLI as the function deploy below.
  - No database password is involved. `db push --linked` mints a temporary login
    role through the Management API, so the access token is the only credential
    the workflow holds.
  - `--include-all` applies a migration whose version sorts below the head of the
    remote history. Without it `db push` refuses the whole batch and skips those
    files on every later run, so a migration merged behind one with a higher
    version would never reach prod.
  - `--yes` answers the confirmation prompt, making the run deterministic rather
    than dependent on an unattended prompt timing out into its default.
  - `db push` reads the project from the linked-project file rather than a
    `--project-ref` flag, which is why `supabase link --project-ref
    dgfeittjtxjtgbretdkj` runs first.
  - Like the function deploy, it takes `workflow_dispatch`
    (`gh workflow run "Deploy migrations"`) and serialises runs through a
    `deploy-migrations` concurrency group that queues rather than cancels — two
    overlapping runs must never interleave against one migration history.
  - A migration's version — the 14 digits before the first underscore of its
    filename — is the primary key Supabase records it under in
    `supabase_migrations.schema_migrations`, so it must be unique across the
    directory. A version already recorded is skipped without an error, so a
    duplicate means one of the pair merges green and never applies; CI's `check`
    job asserts uniqueness (`pnpm check:migrations`).
  - The last step of the deploy re-reads the remote history and fails the run if
    anything in the directory is still unapplied, because `db push` exits 0
    having skipped a version already recorded. A green deploy therefore means
    every migration applied, not merely that the push returned.
- **Migration drift** is caught by `.github/workflows/check-migration-drift.yml`,
  which fails when prod's applied migrations do not match
  `supabase/migrations/`. It runs on two triggers, covering different failures:
  - Every six hours (`cron: '17 */6 * * *'`, off the top of the hour where
    GitHub's scheduler is busiest) plus `workflow_dispatch`. The schedule is what
    catches a migration no deploy trigger ever fired for — one merged by a commit
    that touched nothing under `supabase/migrations/**`, or left behind by a
    deploy that failed unnoticed. Six hours bounds how long such a gap can hide
    at four runs a day rather than an hourly schedule's twenty-four.
  - As the deploy workflow's final step, which catches a partial or silently
    skipped application at the moment it happens.
  - Both invoke `pnpm check:migration-drift`
    (`scripts/check-migration-drift.js`), which reads
    `supabase migration list --linked --output-format json`. That command reports
    the local directory and the remote history table side by side and emits a
    structured document, so the versions come out of a JSON field rather than its
    human table — which is what it prints by default outside an agent session.
    The read is genuinely read-only: it opens no transaction and does not create
    a `supabase_migrations` schema where one is absent. Like `db push --linked`
    it mints a temporary login role through the Management API, so
    `SUPABASE_ACCESS_TOKEN` is the only credential and no database password is
    involved.
  - **A migration in the directory that prod has not applied fails the run.** The
    failure names each file, dates it by when it landed on `main`, and points at
    `gh workflow run "Deploy migrations"`.
  - **A version applied to prod with no file in the directory warns.** It means
    the schema cannot be rebuilt from the repo, which is worth knowing, but it has
    no automated remedy — someone has to decide between committing the migration
    that produced it and clearing the row with
    `supabase migration repair --status reverted <version>`. Failing on it would
    leave the schedule permanently red and train everyone to ignore the signal
    that does have a fix.
  - The scheduled run passes `--grace-minutes=30`, so a migration that landed on
    `main` within the last half hour is reported as an in-flight deploy rather
    than as drift — that is the window in which a deploy is legitimately still
    queued or running. Ages come from
    `git log -1 --format=%cI --diff-filter=A -- <file>`, which is why both
    workflows check out with `fetch-depth: 0`; a file with no commit behind it
    gets no grace. The post-deploy step passes no grace window at all: the push
    has just returned, so anything unapplied there is unapplied for good.
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
  - The CLI bundles each function inside a container, so a Docker daemon that
    cannot start one fails the whole deploy before anything ships, reporting
    `failed to bundle function: exit 125`. The deploy step retries up to three
    times with a 15s and then 30s backoff. It matches on that message rather than
    the process status, because the CLI exits 1 whatever went wrong: 125 to 127
    are Docker's codes for never having run the bundler, whereas a bundler that
    ran and rejected the source reports `exit 1`. Anything but those three codes
    therefore fails on the first attempt, so a real code error is diagnosed at
    once rather than buried under two more attempts. Every attempt's output stays
    on the log.
  - The last step of the deploy re-reads the project's functions and fails the run
    if any function in `supabase/functions/` is missing, not serving, or older
    than its sources. A green deploy therefore means every function reached prod,
    not merely that the CLI returned — the step can ship some functions and fail
    on a later one.
- **Function drift** is caught by `.github/workflows/check-function-drift.yml`,
  which fails when prod's deployed functions do not match
  `supabase/functions/`. Like the migration drift check it runs on two triggers:
  - Every six hours (`cron: '47 */6 * * *'`, the same cadence as the migration
    check and offset half an hour from it so the pair do not queue for a runner at
    the same minute) plus `workflow_dispatch`. The schedule is what catches a
    deploy no trigger ever fired for, one that failed unnoticed, or a function
    deleted from the project by hand.
  - As the deploy workflow's final step, which catches a partial deploy at the
    moment it happens.
  - Both invoke `pnpm check:function-drift`
    (`scripts/check-function-drift.js`), which reads
    `supabase functions list --output-format json` against
    `--project-ref dgfeittjtxjtgbretdkj` — a structured document on the pinned
    CLI, so status and `updated_at` come out of JSON fields rather than its human
    table. Naming the project on the command line is what lets both callers skip
    `link`, so `SUPABASE_ACCESS_TOKEN` is the only credential either holds.
  - **A function missing from prod, one whose status is not `ACTIVE`, and one
    whose deployed copy predates its sources each fail the run.** The failure
    names each function, dates both sides, and points at
    `gh workflow run "Deploy functions"`.
  - **A function deployed to prod with no directory in `supabase/functions/`
    warns.** It serves traffic nothing in the repo defines, which is worth
    knowing, but its remedy deletes a live endpoint
    (`supabase functions delete <slug>`) so nobody should be forced into it by a
    red schedule; failing on it would train everyone to ignore the signal that
    does have a safe fix.
  - A function is dated by its **bundle inputs** — `index.ts` plus every file
    reachable from it through a relative, non-type-only specifier, which pulls in
    the `_shared/` modules it uses — not by its whole directory. `functions
    deploy` uploads a content-addressed bundle and the platform keeps the version
    it already holds when the bundle is byte-identical, leaving `updated_at`
    where it was, so only a change the bundle can see is evidence of a missed
    deploy. Every function directory also holds `*_test.ts` files nothing imports,
    and `supabase/functions/` holds a `README.md` and a `deno.json` whose `tasks`
    and `fmt` sections no bundle reads; dating a function by its directory would
    report every test-only commit as drift forever, since no redeploy could clear
    it. The set is deliberately narrower than the bundle rather than wider — a
    file it omits costs a staleness it could have caught, a file it wrongly
    includes costs a failure nothing can clear. `deno.json`'s `imports` map is one
    such omission: a dependency bump alone changes bundles the check cannot date.
  - The scheduled run passes `--grace-minutes=30`, so a function whose sources
    changed on `main` within the last half hour is reported as an in-flight deploy
    rather than as drift — the window covers a missing brand-new function as well
    as an edited one that is behind. Dates come from
    `git log -1 --format=%cI -- <bundle inputs>`, which is why both workflows
    check out with `fetch-depth: 0`; a function with no commit behind it gets no
    grace. The post-deploy step passes no grace window at all: the deploy has just
    returned, so anything behind there is behind for good.
- **Frontend** — Vercel deploys the PWA on merge to `main`; each PR gets a
  preview deployment (see [Hosting](#hosting)). Live prod may briefly trail
  `main` until the next merge triggers a deploy.

## `service_role` grants

`service_role` has NO blanket table access. Its grants are `select` on `members`
and `select`/`insert`/`update` on `accounts` (migration
`20260719050000_service_role_ledger_grants.sql`), plus the same three on
`account_balance` (`20260802000000_split_account_balance.sql`). The Up functions
read `members` and `accounts` under those grants; every write goes through a
SECURITY DEFINER RPC — the token reads, `upsert_up_accounts`,
`sync_up_gift_transactions`, and `reconcile_up_accounts` — which runs as its
owner, so `transactions` carries no `service_role` grant at all and the sync can
delete a stale `accounts` row through `reconcile_up_accounts` despite holding no
`delete` on the table itself. Any future server-side code touching other public
tables must add its own grants deliberately — the stance is surgical, per-feature.

Two more read paths add their own `select` grants the same way. `eofy-share` /
`eofy-share-file` read the EOFY source tables (`members`, `inflows`,
`tax_profile`, `super_contribution`, `super_profile`, `help_debt`, `deduction`,
`deduction_receipt`, `payslip`) with a service-role client — an anonymous share
token holder has no `auth.uid()` for those tables' RLS to match
(`20260831000000_share_grant.sql`). `notify-eval`, the daily notification
evaluator, reads the plan tables it reconciles the buffer and goal ETAs from:
`budget_line`, `savings_goal`, and `temporary_item` gain a `service_role`
`select`, joining the EOFY set (`members`, `inflows`, `tax_profile`,
`super_contribution`, `help_debt`, `deduction`) and `account_balance` it already
had (`20260905000000_notification_triggers.sql`). It reads `budget_line`
straight — the reconcile triggers keep its derived rows canonical, so it needs
neither the breakdown nor the gift tables. It also holds `select` on
`notification_preference` and `select`/`insert` on `notification_log`; every
write to a preference is a member's own.

## Storage buckets

Both buckets are created by migration, not by hand in the dashboard, so a fresh
environment provisions them with the deploy:

| Bucket     | Migration                          | Holds                      |
| ---------- | ---------------------------------- | -------------------------- |
| `receipts` | `20260803000000_tax_deduction.sql` | deduction receipt files    |
| `payslips` | `20260811000000_payslip.sql`       | attached payslip documents |

Each is **private** (`public = false`) with a single `for all to authenticated`
policy on `storage.objects` gating the object key's first path segment
(`<household_id>`) on household membership. Operational notes:

- The `insert into storage.buckets … on conflict (id) do nothing` and the
  `drop policy if exists` before each `create policy` make both blocks
  idempotent, so a replay of the migration is safe.
- Each block is guarded on `to_regnamespace('storage')`, so it is a no-op wherever
  the `storage` schema is absent. Real Supabase has it; the `rls` CI job gets it
  from the shim in `supabase/tests/rls/setup_auth.sql`.
- Objects are **not** covered by a table backup of `public`. Removing an
  attachment from the app deletes the object and its row together, but a row that
  goes away by cascade (its deduction, payslip, or member removed) leaves the
  object behind — there is no server-side reaper. Orphans are cheap and invisible;
  clearing them is a manual bucket sweep.
- Objects count against the project's storage quota, not the database's.

## Vault secrets

Vault holds every secret that must never reach a client:

| Secret                   | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `up_token:<member_id>`   | a member's Up personal access token                        |
| `up_sync_cron_url`       | the hourly cron's `up-sync` invocation URL                 |
| `up_sync_cron_key`       | the service-role key the cron POSTs with                   |
| `notify_cron_url`        | the daily cron's `notify-eval` invocation URL              |
| `notify_cron_key`        | the service-role key that cron POSTs with                  |
| `anthropic_api_key`      | the `payslip-extract`/`deduction-extract` functions' Anthropic key (see below) |
| `GITHUB_CHANGELOG_TOKEN` | the `changelog` function's GitHub PAT (see below)          |
| `vapid_public_key`       | the Web Push VAPID public key, base64url (see below)       |
| `vapid_private_key`      | the Web Push VAPID private key, base64url                  |
| `vapid_subject`          | the `mailto:` contact URI the VAPID JWT carries            |
| `resend_api_key`         | the `share-create` function's Resend API key (see below)   |

Up tokens are written/read/cleared only by the service-role-only SECURITY
DEFINER RPCs (see [`data-model.md`](data-model.md#rpcs)); the VAPID set is read
by the equally service-role-only `vapid_keys()`, and the Anthropic key by
`anthropic_api_key()`.

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

3. Replay the migration's SQL in the dashboard's SQL editor once the secrets
   exist so the job schedules — the deploy already recorded that version in the
   migration history, so it will not be applied a second time on its own. It
   unschedules any prior `up-sync-hourly` first, so it is safe to re-run; absent
   the secrets it leaves the job unscheduled. Verify with:

   ```sql
   select * from cron.job where jobname = 'up-sync-hourly';
   ```

## notify-eval daily cron (prod only)

Migration `20260905000000_notification_triggers.sql` schedules
`notify-eval-daily` (`0 21 * * *` UTC ≈ 07:00 AEST) on the same `pg_cron` +
`pg_net` pattern and the same skip-if-absent guard as the up-sync cron. Bring it
up the same way:

1. The function auto-deploys via CD.
2. Set the two Vault secrets:

   ```sql
   select vault.create_secret('https://dgfeittjtxjtgbretdkj.supabase.co/functions/v1/notify-eval', 'notify_cron_url');
   select vault.create_secret('<service-role-key>', 'notify_cron_key');
   ```

3. Replay the migration's SQL in the dashboard once the secrets exist so the job
   schedules (it unschedules any prior `notify-eval-daily` first). Verify with:

   ```sql
   select * from cron.job where jobname = 'notify-eval-daily';
   ```

The run reports `{ households, firings, notified, sent, pruned, skipped, failed }`
so a `net.http_post` response row (or a manual `curl` with the service-role
bearer) says what a day's evaluation did. Push delivery still needs the VAPID
keypair set (below); without it `notify-eval` answers `503` and sends nothing.

## `anthropic_api_key` setup

The `payslip-extract` and `deduction-extract` functions each read an uploaded
document with Claude Haiku 4.5, pinned to `claude-haiku-4-5-20251001`. The key
is one household-wide credential shared by both functions (not per member), so
it is a single Vault secret named `anthropic_api_key`. There is no store RPC —
no client ever supplies this key — so the operator writes it by hand once, from
the SQL editor or `psql`:

```sql
select vault.create_secret(
  'sk-ant-…',
  'anthropic_api_key',
  'Anthropic API key for payslip extraction'
);
```

Rotating it is a Vault update, not a re-migration or a redeploy:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'anthropic_api_key'),
  'sk-ant-…'
);
```

The only read path is `public.anthropic_api_key()`
(`20260812000000_anthropic_api_key.sql`) — SECURITY DEFINER, `revoke execute from
public`, granted to `service_role` alone — mirroring `up_token_for_member`. Each
function calls it with its own service-role client; the key never reaches a
client.

Until the secret is set, extraction returns `503` with `{ configured: false }` and
the UI falls back to manual entry with an honest "not configured" note, so the
payslip and deduction-receipt features both work without it.

**Three switched-off states, three fixes.** Extraction answers `503` for each
failure only an operator can clear, and carries its own flag in each so the fix is
never guessed at. All three read to the member as one plain "reading is off" note —
nothing is wrong with their file, no retry is offered, and the figures are typed by
hand meanwhile — but the operator's work differs:

| Flag on the `503` | What happened | The fix |
| --- | --- | --- |
| `configured: false` | No `anthropic_api_key` secret exists | Set it, per the `vault.create_secret` above |
| `outOfCredit: true` | The key's account has no credit left | Top it up at [Plans & Billing](https://console.anthropic.com/settings/billing) |
| `keyRejected: true` | The API refuses the key that is set | Rotate it, per the `vault.update_secret` above |

**When the account runs out of credit.** The API answers `400
invalid_request_error` with "Your credit balance is too low to access the Anthropic
API. Please go to Plans & Billing to upgrade or purchase credits.", which the
function reads as `outOfCredit`. Topping the account up is the whole fix: nothing
needs redeploying or rotating, and the next read succeeds.

A monthly spend limit reached reads instead as a plain rate limit (`429`, "try
again shortly"), because the API reports it identically to a request-rate limit and
the two cannot be told apart. So if reading keeps failing that way with no traffic
to explain it, check the organisation's spend limit alongside its balance.

**When the key itself is refused.** A key that is wrong, revoked, or pasted with a
stray character comes back as `401 authentication_error`; a key the API accepts but
will not let call Messages — the wrong kind of key, or one whose workspace
permissions were narrowed — comes back as `403 permission_error`. The function
reads both as `keyRejected`, because the operator does the same thing either way:
rotate `anthropic_api_key` with `vault.update_secret` (above) to a key from the
right workspace with access to the Messages API. Nothing needs redeploying, and
`anthropic_api_key()` is read per request, so the next read picks the new key up.

The two upstream statuses are not distinguished in the response, because nothing
downstream would act differently on them and the member's note is not a diagnostic
channel. The function logs are: each carries the upstream status and `error.type`
verbatim, so a `401` (a bad key) and a `403` (a key without permission) are told
apart there, alongside this section.

Every other upstream failure stays a `502`/`429`/`504`, deliberately. Only the
API's own verdict on the key matches `keyRejected` — the status **and** that
status's own `error.type` from the response body together — so a `401` from a proxy
in front of the API, which carries no Anthropic error body, still reads as the
generic upstream failure it is. A `403` over billing is claimed by `outOfCredit`
first, since an account to top up is not a key to rotate.

**Cost.** Haiku 4.5 is $1 per million input tokens and $5 per million output. One
payslip is a page or two: a few thousand input tokens (the page image plus its
extracted text, the system prompt, and the tool schema — which asks for the slip's
totals and each printed earnings and tax line) and a few hundred output tokens —
well under a cent per slip. At a fortnightly slip for each of two members
(~104 a year) the whole feature costs cents a year, which is why the cheapest
capable model is the right one here.

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

## `resend_api_key` and `PWA_APP_URL` setup (EOFY sharing)

`share-create` mints a household's EOFY share link and, when Resend is
configured, emails it to the tax agent the household names. Nothing in the app
writes the key — the operator sets it by hand, same pattern as
`anthropic_api_key`:

```sql
select vault.create_secret('re_...', 'resend_api_key', 'Resend API key for EOFY share emails');
```

Rotating it is a Vault update, not a re-migration or a redeploy:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'resend_api_key'),
  're_...'
);
```

The only read path is `public.resend_api_key()`
(`20260831000000_share_grant.sql`) — SECURITY DEFINER, `revoke execute from
public`, granted to `service_role` alone — mirroring `vapid_keys()` and
`anthropic_api_key()`. Until the secret is set, `share-create` still mints the
grant and returns its token (`emailSent: false`), so the feature ships and
degrades to the PWA's Copy Link fallback until the operator sets the secret.

Two plain environment variables (not Vault, since neither is a secret) round
out the setup, set the same way as `GITHUB_CHANGELOG_TOKEN` above:

- **`PWA_APP_URL`** — the PWA's base URL (`https://nest.willsawyerrrr.dev` in
  prod), which `share-create` prefixes onto the token to build the link the
  email carries (`{PWA_APP_URL}/share/eofy/{token}`). Unset, it builds a
  link with an empty origin, which is why prod must set it before the emailed
  link is usable — the PWA's own **Copy Link** button on the EOFY tab builds
  the same path from `window.location.origin` instead, so it works either way.
- **`RESEND_FROM_ADDRESS`** — the sending identity, e.g. `Nest
  <share@notifications.nest.willsawyerrrr.dev>`. Defaults to Resend's shared
  `onboarding@resend.dev` test address, which only delivers to the Resend
  account's own verified email — a real domain must be verified with Resend
  and set here before emailing an arbitrary tax agent's address will work.

Set both in prod with `supabase secrets set PWA_APP_URL=... RESEND_FROM_ADDRESS=... --project-ref dgfeittjtxjtgbretdkj`
and locally in `supabase/functions/.env`.

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
