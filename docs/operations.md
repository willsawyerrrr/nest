# Operations

The concrete runbook for the deployed project: where it runs, what deploys it,
and the one-off setup each moving part needs. For the conceptual pipeline see
[`ARCHITECTURE.md`](ARCHITECTURE.md); for the RPC contracts and schema see
[`DATA_MODEL.md`](DATA_MODEL.md).

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
  `supabase functions deploy --project-ref dgfeittjtxjtgbretdkj`, deploying every
  function and honouring each one's `verify_jwt` from `config.toml` (`up-webhook`
  is pinned `false`; the rest default to `true`). It authenticates with the
  `SUPABASE_ACCESS_TOKEN` GitHub Actions secret.
- **Frontend** — Vercel deploys the PWA on merge to `main`; each PR gets a
  preview deployment (see [Hosting](#hosting)). Live prod may briefly trail
  `main` until the next merge triggers a deploy.

## `service_role` grants

`service_role` has NO blanket table access. It holds only the grants the Up
functions need: `select` on `members` and `select`/`insert`/`update` on
`accounts` (migration `20260719050000_service_role_ledger_grants.sql`). The token
RPCs are SECURITY DEFINER and need no table grants. Any future server-side code
touching other public tables must add its own grants deliberately — the stance is
surgical, per-feature.

## Vault secrets

Vault holds every secret that must never reach a client:

| Secret                     | Purpose                                             |
| -------------------------- | --------------------------------------------------- |
| `up_token:<member_id>`     | a member's Up personal access token                 |
| `up_sync_cron_url`         | the hourly cron's `up-sync` invocation URL          |
| `up_sync_cron_key`         | the service-role key the cron POSTs with            |
| `GITHUB_CHANGELOG_TOKEN`   | the `changelog` function's GitHub PAT (see below)   |

Up tokens are written/read/cleared only by the service-role-only SECURITY
DEFINER RPCs (see [`DATA_MODEL.md`](DATA_MODEL.md#rpcs)).

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

Until the secret is set the function returns `{ configured: false, implemented:
[], inProgress: [] }` (a `200`) and the tab shows a "not configured yet" note, so
it degrades gracefully.

## Auth

Supabase Google OAuth (consent screen published). The site URL and redirect
allow-list cover `nest.willsawyerrrr.dev`, `nest.vercel.app`,
`nest-*-willsawyerrrr.vercel.app` previews, and `localhost:5173`.

## Hosting

Vercel project `nest` on the Pro plan, Root Directory `apps/pwa` (Vite preset).
Prod deploys via the GitHub integration on merge to `main`; each PR gets a
preview deployment. Custom domain `nest.willsawyerrrr.dev`.
`apps/pwa/vercel.json` supplies the SPA fallback rewrite. Env vars:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
