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
`up-webhook/signature.ts` holds the HMAC verification, and `up-connect/connect.ts`
/ `up-disconnect/disconnect.ts` hold the connect/disconnect flows with their I/O
injected so the validate-then-store ordering is tested against fakes.

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
  from Up, and upserts (deduping on `external_id`).

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

```sh
# Serve locally against the running stack.
supabase functions serve up-connect
supabase functions serve up-disconnect
supabase functions serve up-webhook
supabase functions serve up-sync

# Deploy. up-connect and up-disconnect are JWT-verified (the default): the caller
# is resolved from their JWT, so a member can only touch their own token.
supabase functions deploy up-connect
supabase functions deploy up-disconnect

# up-webhook must skip JWT auth so Up can call it unauthenticated; its signature
# check is the security boundary.
supabase functions deploy up-webhook --no-verify-jwt
supabase functions deploy up-sync
```

Register the webhook with Up (pointing at the deployed `up-webhook` URL) via the
Up API, and schedule `up-sync` with `pg_cron`.
