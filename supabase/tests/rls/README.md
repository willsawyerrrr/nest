# SQL assertions

Automated proof that the schema behaves as designed: Row-Level Security isolates
households, the derived-line triggers match the client reconciler, a payslip is
filed under the financial year its pay landed in, and its lines carry the whole of
its reconciliation. These run in CI (the `rls` job) against a plain Postgres
instance and can also be run locally.

## Files

- `setup_auth.sql` — CI-only shim of the auth primitives Supabase provides
  (`auth.users`, `auth.uid()`, `auth.jwt()`, and the `anon`/`authenticated`/
  `service_role` roles). Not used in production.
- `rls_isolation.sql` — the assertions: a member sees only their own household's
  rows, a second user is fully isolated, cross-household writes are rejected, and
  the within-household boundaries hold (per-account balance privacy, private gift
  purchases — budget-linked and ad hoc alike, each tag-hidden from its own
  recipient — and own-device-only push subscriptions).
- `derived_line_triggers.sql` — the assertions that the derived-budget-line
  reconcile triggers produce the exact tuple the client reconciler does, across
  the generic-breakdown and gift lifecycles (add/update/remove items and budgets,
  routing preservation, buyer-account funding, member add/rename/remove, and
  idempotency), plus the household's ad hoc discretionary gift buffer folding
  into the external ("Gifts (others)") partition: a zero amount mints no line, a
  positive one does, it adds to any external gift budgets in the same partition,
  and zeroing or deleting the buffer removes the line once nothing else keeps it.
- `payslip_financial_year.sql` — the assertions that `payslip.financial_year` is
  the year the pay landed in: the derivation at the 30 June boundary, the backfill
  migration moving exactly the rows that disagree with it and rewriting nothing on
  a second pass, and the check constraint refusing a slip filed by the year its
  work fell in. It runs the backfill from the migration file itself (`\ir`), so
  the assertions cover the shipped SQL rather than a copy of it.
- `deduction_basis.sql` — the assertions that a deduction's `basis` and
  `distance_km` are held to the `deduction_basis_attribution` pairing constraint:
  an unqualified insert defaults to the amount basis with no distance, a
  distance-basis row must name a non-negative distance, an amount-basis row must
  name none, and a valid distance-basis row round-trips the client-computed
  `amount_cents` unchanged (the database does not re-derive it from the
  cents-per-km rate, which lives in `@nest/tax`, not in Postgres).
- `deduction_group.sql` — the assertions that grouping a member's deductions
  keeps each payment a deduction in its own right: the group totals its members,
  the composite reference refuses a payment from another financial year or
  another member, the add path's `create_deduction_with_receipts` files a payment
  in the group its payload names, and dropping a group clears its payments'
  `group_id` while leaving the payments themselves — and every other column on
  them — untouched.
- `deduction_work_use.sql` — the assertions that a deduction's work-use
  apportioning is held to its three constraints: `amount_cents` must equal
  `full_amount_cents` at `work_use_percent`, the percentage must fall in (0, 100],
  a distance-basis row is pinned at 100%, and the add path's
  `create_deduction_with_receipts` carries the apportioning it is given.
- `reconcile_up_accounts.sql` — the assertions that the up-sync reconcile RPC
  (SECURITY DEFINER, `service_role` only) deletes a member's individually-owned
  `source = 'up'` account the token stopped reporting when nothing references it
  (its `account_balance` cascading away), flags `deleted_from_source_at` when a
  savings goal still holds it, clears the flag when the account reappears, and
  leaves joint accounts and other households' rows alone.
- `reconcile_joint_up_accounts.sql` — the assertions that the joint twin of that
  RPC (SECURITY DEFINER, `service_role` only) reconciles a household's joint
  (`owner_member_id is null`) `source = 'up'` accounts against the union of its
  members' tokens' ids: it deletes an unreferenced joint account no token
  reports (its `account_balance` cascading away), flags `deleted_from_source_at`
  when a savings goal still holds it, clears the flag when the account reappears,
  and leaves individually-owned accounts and other households' rows alone.
- `share_grant.sql` — the assertions that an EOFY share grant is minted,
  replaced, and revoked only through `create_share_grant`/`revoke_share_grant`:
  a fresh household has no share, creating one returns a 64-hex-char token and
  the row it describes, a second call replaces the row (mints a new token
  rather than adding a second row), `token_hash` is never selectable by
  `authenticated` while the other columns are, a direct insert/update/delete on
  `share_grant` as `authenticated` is refused outright, a co-member's household
  cannot see another household's share, and `revoke_share_grant` deletes the
  row (a no-op when there is none).

## What runs

`setup_auth.sql` → every file in `supabase/migrations/` in order →
`rls_isolation.sql` → `derived_line_triggers.sql` →
`payslip_financial_year.sql` → `payslip_lines.sql` → `deduction_basis.sql` →
`deduction_group.sql` → `deduction_work_use.sql` → `share_grant.sql` →
`reconcile_up_accounts.sql` → `reconcile_joint_up_accounts.sql`.
Because the real migrations and policies are applied, the assertions test the
actual security boundary and trigger behaviour, not a reimplementation.

## Run locally

`payslip_financial_year.sql` and `payslip_lines.sql` include migrations by paths
relative to their own location, so run the scripts by path with a client on the
host rather than piping them into the container on stdin.

```sh
docker run -d --rm --name pba-rls -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
until docker exec pba-rls pg_isready -U postgres -q; do sleep 1; done
export PGHOST=localhost PGPORT=55432 PGUSER=postgres PGPASSWORD=postgres
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/setup_auth.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/rls_isolation.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/derived_line_triggers.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/payslip_financial_year.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/payslip_lines.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/deduction_basis.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/deduction_group.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/deduction_work_use.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/share_grant.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/reconcile_up_accounts.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/reconcile_joint_up_accounts.sql
docker rm -f pba-rls
```
