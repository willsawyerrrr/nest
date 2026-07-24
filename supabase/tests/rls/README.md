# RLS tests

Automated proof that Row-Level Security isolates households. These run in CI (the
`rls` job) against a plain Postgres instance and can also be run locally.

## Files

- `setup_auth.sql` — CI-only shim of the auth primitives Supabase provides
  (`auth.users`, `auth.uid()`, `auth.jwt()`, and the `anon`/`authenticated`/
  `service_role` roles). Not used in production.
- `rls_isolation.sql` — the assertions: a member sees only their own household's
  rows, a second user is fully isolated, and cross-household writes are rejected.
- `derived_line_triggers.sql` — the assertions that the derived-budget-line
  reconcile triggers produce the exact tuple the client reconciler does, across
  the generic-breakdown and gift lifecycles (add/update/remove items and budgets,
  routing preservation, buyer-account funding, member add/rename/remove, and
  idempotency).

## What runs

`setup_auth.sql` → every file in `supabase/migrations/` in order →
`rls_isolation.sql` → `derived_line_triggers.sql`. Because the real migrations
and policies are applied, the assertions test the actual security boundary and
trigger behaviour, not a reimplementation.

## Run locally

```sh
docker run -d --rm --name pba-rls -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
until docker exec pba-rls pg_isready -U postgres -q; do sleep 1; done
docker exec -i pba-rls psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/rls/setup_auth.sql
for f in supabase/migrations/*.sql; do docker exec -i pba-rls psql -U postgres -v ON_ERROR_STOP=1 -f - < "$f"; done
docker exec -i pba-rls psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/rls/rls_isolation.sql
docker rm -f pba-rls
```
