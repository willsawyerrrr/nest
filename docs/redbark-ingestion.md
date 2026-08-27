# Redbark: a multi-bank ingestion source

Background research and a design sketch for using [Redbark](https://redbark.com)
as a second ledger source alongside Up. Nothing here is committed — this is the
detail behind roadmap ideas
[**5** (CSV / multi-source bank import)](roadmap.md#5-csv--multi-source-bank-import)
and
[**6** (super/brokerage balances)](roadmap.md#6-superannuation--brokerage-balances--net-worth-inputs-incl-cdr-super-auto-fetch),
written up the way [`up-ledger-sync.md`](up-ledger-sync.md) writes up the Up
ledger phase: close enough to the schema and edge-function patterns already
shipped that building it later is mostly wiring, not design.

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

Ingestion in this app is Up-only. Two roadmap ideas already name the gap
Redbark fills, and both currently rate the automated path as hard specifically
because of CDR accreditation:

- **Idea 5** wants a source-agnostic import path beyond Up — a joint account
  elsewhere, a credit card, a mortgage offset. Its plan was a hand-rolled CSV
  importer with a column-mapping wizard, because no other structured source
  was in reach.
- **Idea 6** wants automated super/brokerage balances for net worth, and rates
  this infeasible without "a CDR (Open Banking) aggregator or a service like
  Basiq/Frollo" — accreditation this household has no reason to carry on its
  own for a two-person app. Redbark is exactly that class of service: a
  CDR-accredited-via-Fiskil aggregator with a developer API, at consumer-scale
  pricing rather than enterprise B2B contracts.

Both ideas become "call an API with a key" instead of "become CDR-accredited"
or "parse arbitrary bank CSVs" once Redbark (or an equivalent) is in the
picture — though the brokerage half of idea 6 does not run on CDR at all
(next section).

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

- Whether one Redbark subscription covers **two people's** separate bank
  logins — the household's actual shape — or whether each member needs their
  own subscription. Pricing and docs read as single-subscriber; this needs a
  direct question to Redbark or a trial signup before committing, since the
  per-member Vault-token pattern this app already uses for Up assumes
  independent credentials per member.
- The exact JSON response shape for transactions/accounts/balances (the
  general docs describe fields, not a full schema — the OpenAPI spec would
  settle this).
- Whether Redbark models pending vs settled transactions the way Up's
  `HELD`/`SETTLED` status does, given data is proxied live rather than stored.
- The webhook payload/delivery shape (named as a Developer-tier feature,
  undocumented in what was fetched here).
- Whether the `category` field shares any vocabulary with Up's fixed taxonomy
  or is bank-specific/free text.
- Whether SnapTrade's "CommSec" connection exposes CommSec **Pocket** ETF
  holdings, or only the main CommSec trading platform's — Pocket is a
  separate product with its own login. Needs a trial signup.
- The `holdings` / `trades` JSON shape, and whether SnapTrade normalises
  instrument identifiers (ticker, ISIN) across brokers or passes each
  broker's own.

## Sketch: Redbark as an additional ledger source

The schema already anticipates more than one source — `accounts` and
`transactions` both carry a `source` column and dedupe on `(source,
external_id)` — so adding Redbark is additive, not a redesign. The shape below
mirrors the Up connect/sync/disconnect pattern in
[`up-ledger-sync.md`](up-ledger-sync.md#what-already-exists) function for
function.

### Schema

- `ledger_source` is a Postgres enum (`up`, `manual`) defined in
  `supabase/migrations/20260718131611_ledger_core.sql`. Adding Redbark needs
  `alter type public.ledger_source add value 'redbark'` in its own migration —
  Postgres can't add and use a new enum value in the same transaction, so any
  migration that references `'redbark'` runs after the one that adds it.
- No other schema change for the bank path. `public.accounts`,
  `public.account_balance`, and `public.transactions` take a Redbark-sourced
  row exactly as they take an Up one.
- `holdings` and `trades` have **no home in the current schema** and are out
  of scope for this sketch. `equity_grant` models startup equity (options and
  shares with a vesting schedule), not market-listed securities, so roadmap
  idea 6's brokerage balances would need their own table and reconcile pass.
  Everything below covers only the `transactions` / `accounts` bank path.

### Secrets

A Redbark credential (API key, or a per-connection token — see the open
household-vs-member question below) stored in Vault, matching the `up_token:
<member_id>` naming in `supabase/migrations/20260719020000_up_connection.sql`:

- `store_redbark_key(member_id, key)`, `redbark_key_for_member(member_id)`,
  `clear_redbark_key(member_id)` — the same three-function shape as
  `store_up_token` / `up_token_for_member` / `clear_up_token`, each
  `security definer`, each granted to `service_role` alone.
- A non-sensitive `members.redbark_connected_at` timestamp, mirroring
  `up_connected_at`, readable under the existing members RLS.

### Edge functions

- **`redbark-connect`** — mirrors `up-connect`
  (`supabase/functions/up-connect/`): takes `{ key }`, validates it against
  Redbark with a lightweight authenticated call (e.g. `GET /connections`),
  resolves the caller's own member from the JWT (never the body), stores the
  key via the RPC above. The key is never returned to the client.
- **`redbark-disconnect`** — mirrors `up-disconnect`: clears the stored key and
  the connected-at flag.
- **`redbark-sync`** — mirrors `up-sync`: per connected member, `GET
  /accounts` (+ balances) upserted into `accounts` / `account_balance`, then
  `GET /transactions` for the sync window, mapped and upserted into
  `public.transactions` keyed on `(source='redbark', external_id)`.
  `upsert_up_accounts` (`supabase/migrations/20260802000000_split_account_balance.sql`)
  already takes `source` as a field on each input row rather than hardcoding
  `'up'` — only its name is Up-specific, so generalising it (rename to
  `upsert_accounts`, update its one caller) serves both sources rather than
  duplicating the RPC.
- A typed `_shared/redbark.ts` client, the same role `_shared/up.ts` plays for
  Up: request/response types, cursor pagination, and `Retry-After` backoff on
  `429`.

### Field mapping (Redbark → `public.transactions` / `public.accounts`)

Based on the documented fields, not yet verified against a live response:

| `transactions` column | Source |
| --- | --- |
| `external_id` | Redbark's transaction id |
| `source` | `'redbark'` |
| `account_id` | resolve from Redbark's account id → the `accounts` row with `(source='redbark', external_id=<that id>)` |
| `amount_cents` | Redbark's `amount` — confirm sign convention and minor-unit precision before mapping |
| `posted_at` | Redbark's transaction `date` |
| `description` | Redbark's `description` |
| `external_category` | Redbark's `category`, kept verbatim as the source's own label — mirrors how Up's child category lands in `external_category` rather than `category_id` |
| `kind` | sign of `amount` for income/expense, the same rule the Up mapper uses; transfer detection depends on whether Redbark exposes an equivalent to Up's `transferAccount` relationship (unconfirmed) |

### Open questions

1. **Household vs per-member Redbark account.** Up's model is one personal
   token per member, so account ownership is derived from *whose token* saw
   the account. Redbark's pricing reads as one subscriber with N bank
   connections — settling whether that one subscription can hold both
   household members' banks (and if so, whether Redbark's own connection
   metadata says which person a connection belongs to) decides whether nest
   stores one household-level key or two per-member keys, and how
   `owner_member_id` gets derived.
2. **Rate limit headroom.** 30 requests/minute comfortably covers an hourly
   sync for a two-person household; worth confirming page sizes so a routine
   poll stays a handful of calls, the same way the Up poll does.
3. **Cost vs value.** A$10–16/month recurring, for a feature this household's
   current single-bank (Up) setup doesn't need. Worth adding once a second
   bank is genuinely in play — a mortgage offset account, a brokerage — not
   speculatively.
4. **Category taxonomy overlap.** Whether Redbark's `category` field can share
   a mapping with Up's fixed taxonomy for spend reconciliation
   ([`up-ledger-sync.md`](up-ledger-sync.md#3-reconcile-actual-spend-vs-budget)),
   or needs its own `external_category` → `budget_group` map.
5. **Brokerage rail.** Holdings and trades ride SnapTrade on the Professional
   tier, with credential-based auth rather than a revocable CDR consent, and
   land in a schema this sketch does not design. Whether SnapTrade's CommSec
   connection reaches CommSec **Pocket** holdings is unverified. Worth taking
   on only once a brokerage balance genuinely needs to be in net worth, and
   as its own phase after the bank path.

### Where this lands relative to the roadmap

This is not a substitute for the Up ledger sync phase
([`up-ledger-sync.md`](up-ledger-sync.md)) — it is roadmap idea 5 done through
a paid CDR aggregator instead of a hand-rolled CSV importer, and it is what
turns roadmap idea 6's super/brokerage automation from infeasible to a
developer-API integration — brokerage via SnapTrade's credential rail on the
Professional tier, and needing a holdings table this sketch leaves for its
own phase. It lands after the Up ledger sync foundation, since
it shares the same `accounts` / `transactions` tables and the same
`(source, external_id)` dedupe pattern, and is worth building once an actual
second bank need exists rather than ahead of one.
