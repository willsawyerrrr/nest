# Redbark: a multi-bank ingestion source

Background research on [Redbark](https://redbark.com) as a second ledger
source alongside Up, and the shipped design of its **accounts and balances**
slice (no transactions, no brokerage/holdings — see
[`docs/architecture.md`](architecture.md#redbark-api) and
[`supabase/functions/README.md`](../supabase/functions/README.md#redbark-bank-sync)
for the built implementation). Written up the way
[`up-ledger-sync.md`](up-ledger-sync.md) writes up the Up ledger phase.

## Background

Redbark is a data API over Australian and NZ bank accounts, built for
developers rather than end-consumer budgeting. Its bank data sits on top of
the regulated Open Banking rails rather than screen-scraping; its brokerage
data rides a separate provider (see below):

- **Access rail.** Australian banks connect through the Consumer Data Right
  (CDR) via [Fiskil](https://fiskil.com), an ACCC-accredited intermediary; NZ
  banks connect through [Akahu](https://akahu.nz). Redbark holds the
  accreditation relationship, not the household — this is the point of using
  it rather than integrating CDR directly.
- **Coverage.** 100+ AU/NZ institutions, including the Big Four (CommBank,
  Westpac, ANZ, NAB), Macquarie, and Up Bank itself. Brokerage coverage
  (Interactive Brokers, CommSec, Stake) comes through a separate provider,
  not the CDR bank rail — see
  [Brokerage is a separate rail](#brokerage-is-a-separate-rail-snaptrade-not-cdr).
- **API shape.** Bearer-token REST API, eight endpoints across transactions,
  balances, accounts, connections, holdings, and trades (the last two
  brokerage-only). A transaction record
  carries roughly 12 fields — date, amount, currency, description, category,
  merchant among them. Rate limit is 30 requests/minute per key, with
  `X-RateLimit-*` headers and `Retry-After` on `429`.
- **Data handling.** Every call proxies live from the bank at request time;
  Redbark states it never stores transactions, balances, descriptions, or
  merchants in its own database.
- **Connection setup.** Per-bank consent through Fiskil/Akahu's flow, not a
  single static token — closer to an OAuth-style redirect per bank than Up's
  copy-paste personal access token.
- **Pricing.** Saver A$10/mo (3 bank connections, 12 accounts), Developer
  A$16/mo (adds API access + webhooks, 6 connections), Professional A$24/mo
  (unlimited connections/accounts, brokerage support). A 7-day free trial
  needs no card. Billing reads as per-subscriber, with no named household or
  multi-user plan.

### Why it's relevant here

Ingestion in this app is Up-only. Two tracked ideas already name the gap
Redbark fills, and both currently rate the automated path as hard specifically
because of CDR accreditation:

- **The multi-source import idea** wants a source-agnostic import path beyond Up
  — a joint account elsewhere, a credit card, a mortgage offset. Its plan was a
  hand-rolled CSV importer with a column-mapping wizard, because no other
  structured source was in reach.
- **The super/brokerage-balances idea** wants automated super/brokerage balances
  for net worth, and rates
  this infeasible without "a CDR (Open Banking) aggregator or a service like
  Basiq/Frollo" — accreditation this household has no reason to carry on its
  own for a two-person app. Redbark is exactly that class of service: a
  CDR-accredited-via-Fiskil aggregator with a developer API, at consumer-scale
  pricing rather than enterprise B2B contracts.

Both ideas become "call an API with a key" instead of "become CDR-accredited"
or "parse arbitrary bank CSVs" once Redbark (or an equivalent) is in the
picture — though the brokerage half of that second idea does not run on CDR at
all (next section).

### Brokerage is a separate rail (SnapTrade), not CDR

CDR does not reach brokerage accounts. Its designated sectors are banking
(2020), energy (2023), and non-bank lending (from July 2026); securities,
share trading, and CHESS holdings have never been designated, and the live
"open finance" expansion is non-bank lending, not investments. So the
Fiskil/CDR rail above covers only the **cash** side of investing — a CommSec
trade settles through a linked CommBank account (a CDIA or other CBA
transaction account), and that account's balance and transactions are
CDR-visible as CBA deposit-account data, but the portfolio behind it is not.

Redbark's `holdings` and `trades` endpoints are powered by
[SnapTrade](https://snaptrade.com), a distinct provider from the Fiskil
bank rail, and are **Professional-tier only** (A$24/mo). SnapTrade connects
roughly 28 brokerages and 3 crypto exchanges — CommSec, Stake, Interactive
Brokers, Coinbase, and Binance among them — by a credential/login-based
connection, since these brokers expose no official retail API. Brokerage
endpoints are not cached: every request fetches live from SnapTrade, the
same live-proxy shape the bank rail has.

This is a different trust model from CDR. A bank connection is accredited,
scoped, and revocable through Fiskil's consent flow; a brokerage connection
hands a broker login to SnapTrade. Worth weighing before the household
commits a CommSec login to it.

**CommSec Pocket specifically is unconfirmed.** SnapTrade lists "CommSec",
which means the main CommSec trading platform. CommSec Pocket is a separate
product with its own app and often its own login, and whether its ETF
holdings surface through the CommSec connection needs a trial to verify.

### What isn't confirmed yet

- **Balance sign convention.** Whether `GET /accounts/{id}/balance`'s
  `current.amount` comes back negative for a liability (a credit card, a home
  loan) the way Up's `valueInBaseUnits` does, or always non-negative with the
  liability-ness carried elsewhere. Unverified against a live response;
  `redbark-sync/map.ts` passes `current.amount` straight through
  (`balance_cents`), so a wrong assumption here shows up as a liability
  displaying as a positive balance rather than a mapping crash.
- **Account type taxonomy.** `AccountItem.type` is a documented open string
  with no enumerated values, so `redbark-sync/map.ts`'s `mapAccountType` is a
  best-effort case-insensitive keyword match (see its doc comment for the
  exact rules) pending real Redbark response samples to confirm or replace it.
- **CommSec Pocket** and the `holdings` / `trades` JSON shape remain
  unconfirmed — moot for the shipped accounts/balances slice, relevant only if
  the brokerage rail (below) is ever built.

## Shipped: Redbark accounts and balances

Bank **accounts and balances only** — no transactions, no brokerage/holdings.
`accounts` and `account_balance` already carry a `source` column and dedupe on
`(source, external_id)`, so a Redbark-sourced row lands in them exactly as an
Up-sourced one does; the shape below follows the Up connect/sync/disconnect
pattern in [`up-ledger-sync.md`](up-ledger-sync.md#what-already-exists)
function for function, adjusted for two confirmed differences from the
original sketch: Redbark connects through a hosted Link Session redirect, not
a pasteable token, and exposes no owner field to derive `owner_member_id`
from, so ownership is tracked in Nest's own `redbark_connection` table
instead.

### Schema

- `ledger_source` gained `'redbark'` (`20260919000000_ledger_source_redbark.sql`),
  in its own migration — Postgres can't add and use a new enum value in the
  same transaction, so every later migration naming `'redbark'` is a separate,
  later-timestamped file.
- `redbark_connection` (`20260919010000_redbark_connection.sql`): `id`
  (Redbark's own connection id), `household_id`, `member_id` (composite FK to
  `members (id, household_id)`), `institution_name`, `status`. Household
  members can `select`; every write goes through
  `redbark-connect-complete` / `redbark-disconnect` / `redbark-sync`, so
  writes are `service_role`-only with no `authenticated` write grant.
- No other schema change for the bank path — `public.accounts` and
  `public.account_balance` take a Redbark-sourced row like an Up one.
  `holdings` and `trades` have no home in the schema and stay out of scope
  (see *Brokerage is a separate rail*, above).

### `redbark_connection` ownership

Redbark exposes no owner/customer-reference field on its own `Connection` or
`AccountItem` objects (confirmed by inspecting both the v1 and v2 OpenAPI
specs), so ownership is tracked entirely in `redbark_connection`: a connection
always belongs to the member who completed its consent flow, and every
account synced through it takes `owner_member_id = member_id`. Unlike Up,
there is no joint-Redbark concept and no joint reconcile pass — Redbark has no
way to tell Nest whether the underlying account is legally joint.

### Secrets

One platform-wide `REDBARK_API_KEY` — a plain edge function secret (not
Vault), read as `Deno.env.get('REDBARK_API_KEY')` — covers every bank
connection the household makes, unlike Up's per-member Vault-held token. See
[`docs/operations.md`](operations.md#redbark_api_key-setup).

### Edge functions

- **`redbark-connect`** — takes `{ returnUrl }`, resolves the caller's own
  member from the JWT, and starts a Redbark Link Session
  (`POST /link_sessions`, `RedbarkClient.createLinkSession`), returning
  `{ linkSessionId, url }`. The frontend redirects the browser to `url`, where
  the member completes Fiskil's consent flow before being sent back to
  `returnUrl`. There is no server-side pending-session table: the frontend
  carries `linkSessionId` through the round trip itself (e.g. in
  `sessionStorage`).
- **`redbark-connect-complete`** — takes `{ linkSessionId }`, resolves the
  caller's own member and household, and resolves the session
  (`GET /link_sessions/{id}`). A `pending` session reports
  `{ connected: false, status: 'pending' }` (a normal, expected state, not an
  error); a failed or connection-less one reports
  `{ connected: false, status: 'failed', reason }`; a completed one reads the
  resulting connection's institution (`GET /connections/{id}`), upserts a
  `redbark_connection` row, and reports `{ connected: true }`. Refreshing the
  newly connected accounts is left to the frontend (calling `redbark-sync`
  once this returns `connected: true`) rather than an edge-function-to-edge-function
  call — nothing else in this codebase invokes one function from another.
- **`redbark-disconnect`** — takes `{ connectionId }`, checks the caller owns
  the named `redbark_connection` row (404 if it does not exist, 403 if it
  belongs to a co-member), revokes it with Redbark
  (`DELETE /connections/{id}`, treating Redbark's `connection_not_found` error
  code as already-gone rather than a failure), and deletes the local row.
- **`redbark-sync`** — per connection: `GET /accounts?connection=<id>`
  (paginated via `next_page_url`), filtered to `category = 'banking'`, then
  `GET /accounts/{id}/balance` per surviving account. Rows upsert via
  `upsert_accounts` — the RPC `up-sync` also uses, `source` a field on each
  row rather than hardcoded. Per member, `reconcile_source_accounts` (also
  shared with `up-sync`, called with `p_source => 'redbark'`) reconciles that
  member's Redbark accounts against the union of external ids present across
  every one of their connections (a member can have more than one bank
  connected). `reconcile_joint_up_accounts` stays Up-only, since a Redbark
  connection is never joint.
- **`_shared/redbark.ts`** — a typed client mirroring `_shared/up.ts`'s shape:
  injectable `fetchImpl`, a private throwing request helper (`RedbarkApiError`,
  carrying the HTTP status and the error envelope's `code`), a private
  async-generator paginator following `next_page_url`, and public methods
  `ping`, `listAccounts`, `getBalance`, `getConnection`, `deleteConnection`,
  `createLinkSession`, `getLinkSession`. Every request sends both
  `Authorization: Bearer <key>` and the required `Redbark-Version` header.

### Field mapping (Redbark → `public.accounts`)

| `accounts` column | Source |
| --- | --- |
| `external_id` | Redbark's account id |
| `source` | `'redbark'` |
| `owner_member_id` | the owning connection's `member_id` (never joint) |
| `name` | Redbark's account `name`, prefixed `"<member>'s "` when the mapped `type` is `transaction` (mirrors `up-sync/map.ts`'s `accountName`) |
| `type` | best-effort keyword heuristic over Redbark's `type` string and `name` (see *What isn't confirmed yet*) |
| `balance_cents` | `GET /accounts/{id}/balance`'s `current.amount` (see *Balance sign convention*, above) |
| `currency` | the balance's `currency`, falling back to the account's own, uppercased |

### Rate limits

Confirmed tiers: connections/accounts listing 60 req/min, balance/account
reads 30 req/min, link-session creation 30 req/min. A two-person household's
hourly sync is trivially within every tier — sequential awaits, no
concurrency — but a `429` is surfaced (`RedbarkApiError`, message names
`Retry-After`) rather than swallowed.

## Brokerage rail (out of scope, unbuilt)

Holdings and trades ride SnapTrade on Redbark's Professional tier, with
credential-based auth rather than a revocable CDR consent, and would need
their own table and reconcile pass — `equity_grant` models startup equity, not
market-listed securities. Worth taking on only once a brokerage balance
genuinely needs to be in net worth, and as its own phase after this one.

## Where this lands

Everything above stops at `accounts` / `account_balance` — what a
Redbark-sourced account unlocks in **pay splits** and **savings goals** (both
already built on top of these same tables) is
[`cdr-pay-splitting-goals.md`](cdr-pay-splitting-goals.md).
