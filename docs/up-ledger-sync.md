# Up ledger + reconciliation

A phase (tracked in Linear): pull *all* actual Up transactions to reconcile
spend and tax against the plan. It is layered on top of the plan-only app, Up
savers, super, and gifts, and breaks into four stages:

- [x] Account/transaction sync: scheduled poll, deduped on `external_id`
  (poll-only; webhook ingestion is its own sub-stage below).
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget.
- [ ] Track actual tax paid (PAYG withheld) vs the estimate.

Transaction sync is the foundation; a read-only ledger UI sits over it, then the
two reconciliation layers that consume the synced data.

## What exists

The account sync, the transaction poll, and recategorising from Nest are built
and deployed.

- **`_shared/up.ts`** — a typed Up client (JSON:API, bearer per-member token). It
  models `UpTransaction` (status `HELD`/`SETTLED`, `description`, `message`,
  `isCategorizable`, `amount`, `createdAt`, `settledAt`, `transactionType`,
  `deepLinkURL`, `note`, `performingCustomer`; relationships `account`,
  `category`, `parentCategory`, `transferAccount`) and exposes
  `listTransactions({ since, category })`, `listAccountTransactions(accountId,
  since)` and `getTransaction(id)` (null on a `404`), each list with
  `page[size]=100`, walking `links.next` to completion. A `429` on a read is
  retried up to three times after Up's `Retry-After` (else an exponential
  backoff from one second), each wait capped at 30 seconds. `listCategories()`
  reads the unpaginated taxonomy, and `categoriseTransaction(id, categoryId)`
  `PATCH`es a transaction's category (a child id, or null to clear it; `204` on
  success, a `429` thrown rather than retried). It does **not** model tags or
  webhook registration.
- **`up-sync/map.ts`** — `mapTransaction(tx, accounts)` maps an `UpTransaction`
  onto the row `sync_up_transactions` takes (see the field mapping below),
  resolving the account from a lookup the sync layer passes in and returning
  null — a skip — for an account that is not synced. It stays pure, and never
  produces `notes` or `category_id`.
- **`up-sync/`** (index + sync) — three passes per member, in order: every
  account's balance; every account's transactions since its own high-water mark;
  a rescan of the gift category over a 365-day trailing window. Two callers: a
  member's manual refresh (JWT, scoped to their household) and the hourly
  `pg_cron` service-role invocation (all households), told apart by the JWT
  `role` claim. Accounts dedupe on `(source, external_id)`, collapsing joint
  accounts to one shared row (`owner_member_id` null), attributing individual
  accounts to their owner, and prefixing individual spending-account names.
  Once per run, through the first member whose token lists their accounts, it
  refreshes `up_category` from `GET /categories` via `sync_up_categories`.
  Idempotent throughout.
- **`up-categorise/`** — recategorises one Up transaction from Nest (see
  [Recategorising from Nest](#recategorising-from-nest-up-categorise)). The MCP
  server's `categorise_transaction` tool calls it.
- **`up-webhook/`** — deployed with `verify_jwt = false` (Up calls it
  unauthenticated) and a working `X-Up-Authenticity-Signature` HMAC-SHA256 check
  (`signature.ts`, constant-time compare). The handler switches on `PING` /
  `TRANSACTION_CREATED` / `TRANSACTION_SETTLED` / `TRANSACTION_DELETED` but the
  transaction branch is a **TODO** — it extracts the transaction id and returns
  `200` without persisting anything. It reads a single `UP_WEBHOOK_SECRET` env
  var (see the per-member-secret gap under webhook ingestion). The poll does not
  depend on it, and the gift rescan cannot: no event fires on recategorisation.
- **`public.transactions`** — `household_id`, `account_id` (FK
  `(id, household_id)`), `member_id` (nullable attribution), `category_id`
  (nullable), `external_category` (Up's child category),
  `external_parent_category`, `external_category_since` (when the sync first saw
  the current category), `posted_at`, `amount_cents` (signed), `description`,
  `kind` (`income`/`expense`/`transfer`), `status` (`pending`/`settled`),
  `source` (`up`/`manual`), `external_id`, `is_categorizable`,
  `transaction_type`, `deep_link_url`, `up_message`, `up_note`,
  `performing_customer_name`, and `notes` — the household's own, which the sync
  never writes. `unique (source, external_id)` and `unique (id, household_id)`;
  RLS gates each row on the balance-visible account set and withholds a row
  claimed as a gift for the caller
  (`hidden_gift_transaction_ids_for_current_member()`: the spend behind
  someone's surprise stays out of their ledger view too); indexed on household,
  account, category, posted_at. **Populated with every Up transaction.**
- **`public.up_category`** — Up's category taxonomy (`id`, `name`,
  `parent_id`, null for a parent), shared by every household; `authenticated`
  reads it, and only `sync_up_categories` writes it.
- **`public.categories`** — hierarchical income/expense taxonomy per household
  (`parent_id`, `kind`, `is_archived`). Exists but unpopulated; not linked to Up's
  category taxonomy, so a synced row's `category_id` is null and its Up category
  sits in `external_category`.
- **`service_role` grants** — surgical: `select` on `members`,
  `select`/`insert`/`update` on `accounts` and on `account_balance`, and
  `select` on `transactions`. `transactions` and `up_category` are written only
  through the `sync_up_transactions`, `delete_up_transactions`,
  `sync_up_categories`, and `set_up_transaction_category` SECURITY DEFINER RPCs,
  so `service_role` holds no write grant on either table (per the surgical grant policy,
  [`operations.md`](operations.md#service_role-grants)).

## Up API facts that shape the design

From <https://developer.up.com.au/> (base `https://api.up.com.au/api/v1`,
`Authorization: Bearer <token>`, JSON:API). The API is read-only except for a
transaction's category and tags and for webhooks:

- **List:** `GET /transactions` and `GET /accounts/{id}/transactions`, newest
  first. Params: `page[size]`, `filter[since]` / `filter[until]` (RFC-3339, both
  bounding `createdAt` — not `settledAt`, so not `posted_at`),
  `filter[status]` (`HELD`/`SETTLED`), `filter[category]`, `filter[tag]`.
  Pagination is opaque cursors in `links.next` — follow until `null`, never
  construct URLs.
- **Single:** `GET /transactions/{id}` — the gift rescan's re-read, and the
  webhook path's fetch; `404` once Up no longer has the transaction.
- **Category write:** `PATCH /transactions/{id}/relationships/category` sets a
  categorisable transaction's child category (`data: {type: 'categories', id}`),
  or clears it (`data: null`), answering `204`. Tags are added and removed
  through `/transactions/{id}/relationships/tags`. Nest writes the category
  (`up-categorise`), never tags.
- **Transaction resource:** `status` (`HELD`/`SETTLED`), `amount`
  (`valueInBaseUnits` signed int cents), `description`, `message`, `rawText`,
  `createdAt`, `settledAt` (null while `HELD`), `isCategorizable`,
  `transactionType`, `deepLinkURL`, `note` (`{text}` or null),
  `performingCustomer` (`{displayName}` or null — the 2Up cardholder), `roundUp`,
  `cashback`, `foreignAmount`, `cardPurchaseMethod`, `holdInfo`. Relationships:
  `account`, `category` (child only, nullable), `parentCategory` (nullable),
  `tags` (array), `transferAccount` (nullable — set on inter-account transfers),
  `attachment`.
- **Webhooks:** `POST /webhooks` `{data:{attributes:{url, description}}}` returns
  `secretKey` **once** (store it — it keys the HMAC). Max **10 webhooks per
  user**. `GET/DELETE /webhooks/{id}`, `POST /webhooks/{id}/ping`,
  `GET /webhooks/{id}/logs`. Events: `PING`, `TRANSACTION_CREATED`,
  `TRANSACTION_SETTLED`, `TRANSACTION_DELETED`. **Webhooks are per-token (per
  user).** A delivery's body carries only the transaction id, not the member — the
  receiver must know whose token fetches it (see webhook member routing below).
- **Rate limits:** `429` on throttle, `X-RateLimit-Remaining` header; the
  client retries after `Retry-After`, else with exponential backoff.
- **Categories:** `GET /categories` — non-paginated, fixed parent/child taxonomy
  (e.g. child `restaurants-and-cafes` under parent `good-life`). Child only can be
  assigned to a transaction. Mirrored into `up_category` each sync run.
- **Tags:** `GET /tags` — paginated custom labels, max 6 per transaction.

## 1. Transaction sync (foundation)

Ingestion into `public.transactions` is idempotent on `(source='up',
external_id)`, mirroring the account dedupe. The scheduled poll is built; webhook
ingestion is the next sub-stage.

### Scheduled poll (built)

Per connected member, after the account pass, `up-sync` runs two transaction
passes, each settled independently so a failure in one costs only that pass for
that member.

**Ledger pass.** For each of the member's Up accounts, `listAccountTransactions`
from that account's own `since`, mapped against the accounts just upserted and
landed through `sync_up_transactions` in batches of 500. A joint account seen
through both partners' tokens is read once per run, through the first.

- `since` is derived, not stored: `max(posted_at)` of the account's synced Up
  rows outside the gift category minus 24 hours (the gift rescan lands gift rows
  over its own year-long window, so they say nothing about how far this pass has
  read), so a hold that settles after a later transaction was
  synced, and clock skew, are not stepped past; the upsert makes the overlap
  harmless. `filter[since]` bounds `createdAt`, and a transaction that settles
  days after creation is re-read inside the overlap while it is the account's
  latest, its `status`/`settledAt` flowing through the upsert.
- An account with no synced rows backfills from midnight AEST on 1 July of the
  prior financial year — two financial years, all tax and budget reconciliation
  read, and a bound on the first run's volume. Because the mark is per account,
  an account newly visible to a member backfills even when their others are
  current, and an empty account costs one empty page.

**Gift rescan.** The per-account mark never revisits a transaction behind it, and
a transaction's category is not part of any cursor Up offers — no `updatedAt`, no
event on recategorisation, and `filter[since]` filters on `createdAt`, which never
moves. Most gift spend is categorised by hand well after the purchase (Up files it
under the merchant's category first), so every run also lists
`listTransactions({ since, category: 'gifts-and-charity' })` over a fixed 365-day
trailing window (a year keeps a full annual cycle of occasions in scope, and is a
handful of pages once `filter[category]` has narrowed it) and lands it, catching a
transaction moved into gifts behind the mark.

A stored gift-category row in the window, on one of the member's accounts, that
Up no longer lists in the category was recategorised away or deleted. Each is
re-read with `getTransaction`: one that exists is refreshed in place with its new
category — the row, and any dismissal or purchase on it, stays, and drops out of
the inbox — and one Up answers `404` for is deleted through
`delete_up_transactions`, unless a `gift_purchase` links it (the household already
claimed it). A row recategorised away once older than the window keeps its gift
category; dismissing it as "not a gift" clears it from the inbox.

Recategorisation in the Up app between two non-gift categories behind the mark
is not caught; nothing reads those categories until the category mirror
(stage 3). A recategorisation made from Nest is recorded on the row at once (see
below).

**`sync_up_transactions(p_household_id, p_rows)`** upserts on `(source,
external_id)` and returns `table(id, inserted)` (`xmax = 0` on a fresh insert),
so a caller can act on newly arrived transactions. It never writes `notes`,
`category_id`, or `created_at`; it restamps `external_category_since` only when
`external_category` changes, so the gift-candidate notification fires for a
recategorisation into gifts; it holds a linked `gift_purchase` to its
transaction's amount; and it leaves a conflicting row in another household
alone.

### Recategorising from Nest (`up-categorise`)

A member changes an Up transaction's category from Nest, and the change is
written back to Up so Up's own insights stay correct. `up-categorise`
(JWT-verified) takes `{ transaction_id, category_id }` — a Nest transaction id,
and an Up child category id or null to clear the category:

1. Reads the transaction through the caller's own RLS-scoped client, so a row
   outside their balance-visible accounts (or claimed as a gift for them) is
   `transaction_not_found`.
2. Refuses a non-Up row (`not_up_transaction`) and one Up marks uncategorisable
   (`is_categorizable = false`, e.g. a transfer: `not_categorisable`).
3. Checks the category against `up_category`: unknown is `unknown_category`, a
   parent is `parent_category`.
4. Reads the caller's own token through `up_token_for_member`; a member without
   one gets `up_not_connected`, whose copy points at Connections. The write uses
   the caller's token even on a joint account, so Up decides what that token can
   touch.
5. `PATCH`es the category. A failure is a stable code with fixed copy from
   `_shared/upFailure.ts` — `up_auth_failed` (401/403), `up_rate_limited` (429,
   retryable), `up_transaction_not_found` (404), `up_rejected` (400/422), else
   `up_unavailable` — and Up's body is only logged.
6. Records the category on the row through `set_up_transaction_category`
   (`external_category`, `external_parent_category` from `up_category`, and
   `external_category_since` restamped on a change), so a transaction moved into
   `gifts-and-charity` joins the Gifts inbox, and its gift-candidate
   notification, straight away. A failure here is `save_failed`: Up has the
   category, and the next sync's rescan or ledger pass brings the row in line.

### Webhook — near-real-time (`up-webhook`, next)

Fill in the existing TODO. On `TRANSACTION_CREATED` / `TRANSACTION_SETTLED`:
resolve the member, fetch `GET /transactions/{id}` with that member's Vault token,
map, and upsert. On `TRANSACTION_DELETED`: delete the matching
`(source='up', external_id)` row. `PING` stays a bare `200`.

The hard part is **member routing**: the delivery body identifies only the
transaction, and each member registers their own webhook with a distinct
`secretKey`. Two viable approaches (an open question):

1. **Per-member URL** — register each member's webhook at a URL carrying their
   member id (path segment or query, e.g.
   `.../up-webhook/<member_id>` or `?m=<member_id>`). The handler reads the id,
   loads that member's secret from Vault to verify the HMAC, then uses that
   member's token to fetch. Clean routing; the id is opaque and the HMAC still
   gates authenticity, so a guessed id buys nothing without the secret.
2. **Try-all-secrets** — store all members' webhook secrets and verify the body
   against each; the one that validates identifies the member. Works with a fixed
   URL but is O(members) HMACs per delivery and muddier.

Either way, **`UP_WEBHOOK_SECRET` (a single env var) must become per-member
secrets in Vault** (e.g. `up_webhook_secret:<member_id>`), captured at
registration time — Up returns each `secretKey` only once. Registration itself is
new work (see below).

Because a joint account is visible through both partners' tokens, a joint
transaction fires **two** deliveries (one per member's webhook). The
`(source, external_id)` upsert collapses them to one row — the same dedupe the
account sync relies on. Attribution for a joint-account transaction is `member_id`
null (mirror the account: derive `member_id` from the resolved account's
`owner_member_id`, which is null for joint).

### Field mapping (Up transaction → `public.transactions`)

`mapTransaction` produces every column below except `category_id`. The account
lookup it takes is resolved in the sync layer, so the mapper stays I/O-free:

| `transactions` column | Source |
| --- | --- |
| `external_id` | `tx.id` |
| `source` | `'up'` |
| `account_id` | resolve from `tx.relationships.account.data.id` → the `accounts` row with `(source='up', external_id=<that id>)`; carry its `household_id` |
| `household_id` | from the resolved account |
| `member_id` | the resolved account's `owner_member_id` (null for joint — attribution mirrors the account) |
| `amount_cents` | `tx.attributes.amount.valueInBaseUnits` (already signed) |
| `posted_at` | `settledAt ?? createdAt` |
| `description` | `tx.attributes.description` |
| `status` | `SETTLED`→`settled`, `HELD`→`pending` |
| `kind` | `transferAccount` set → `transfer`; else `amount < 0` → `expense`, else `income` |
| `external_category` | `tx.relationships.category.data?.id` — Up's child category |
| `external_parent_category` | `tx.relationships.parentCategory.data?.id` |
| `is_categorizable` | `tx.attributes.isCategorizable` |
| `transaction_type` | `tx.attributes.transactionType` |
| `deep_link_url` | `tx.attributes.deepLinkURL` |
| `up_message` | `tx.attributes.message` |
| `up_note` | `tx.attributes.note?.text` |
| `performing_customer_name` | `tx.attributes.performingCustomer?.displayName` |
| `notes` | never written — the household's own |
| `category_id` | null — see below |

**Categories/tags.** Up's category is a fixed child-under-parent taxonomy;
`public.categories` is a per-household hierarchy that's currently empty. A synced
row keeps Up's own child and parent categories verbatim in `external_category`
and `external_parent_category` (the former is how the gift inbox recognises its
candidates) and leaves `category_id` null. Filling `category_id` is the
Up-category mirror (stage 3 below): seed Up's `GET /categories` into
`public.categories` per household (`source`-tagged) and map each transaction's
child + parent onto it, before spend reconciliation (which needs categories to
group spend). Up **tags** (custom
labels, max 6) have no column; the gift use case is served by the category
instead, so tags stay unmapped.

**Pending vs settled.** Both are persisted. A `HELD` transaction lands as
`pending` with `posted_at = createdAt`; when it settles, the next poll upserts it
to `settled` with `posted_at = settledAt`. A hold Up drops without settling
(`TRANSACTION_DELETED`) is deleted only by the gift rescan, and only in the gift
category; elsewhere it stays `pending` until webhook ingestion deletes it. The UI
and reconciliation can then choose whether to count pending spend (an open
question — see reconciliation).

### Webhook registration (new)

Nothing registers webhooks today. Add registration to the connect flow (or a
dedicated action):

- On `up-connect` success (token stored), call `POST /webhooks` with the
  function's public URL (per-member variant per the routing decision) and store
  the returned `secretKey` in Vault (`up_webhook_secret:<member_id>`), plus the
  webhook id (for later `DELETE`).
- On `up-disconnect`, `DELETE /webhooks/{id}` and clear the stored secret.
- Idempotency: check `GET /webhooks` before creating so reconnecting doesn't
  breach the 10-per-user cap or leave orphans.

### Stages (smallest-useful-first)

1. **Poll-only transaction sync (built).** Every category, a bounded backfill on
   an account's first run and a derived per-account `since` after,
   `category_id` null, the `transfer` kind, `member_id` from the account owner.
   This populates the ledger.
2. **Webhook ingestion.** Per-member webhook registration on connect/disconnect,
   per-member secrets in Vault, fill the `up-webhook` TODO (fetch-map-upsert +
   delete). Poll becomes the backstop.
3. **Up-category mirror.** Seed `public.categories` from `GET /categories`, map
   `category_id` on sync. Prerequisite for spend reconciliation.

Risks for this section: **rate limits** on backfill (bounded window,
`page[size]=100`, `429` retried after `Retry-After`); **webhook security** (HMAC per-member secret,
constant-time compare — already in place; reject unsigned/mismatched);
**idempotency** (the `(source, external_id)` upsert + overlap window make
re-delivery and re-poll safe; `TRANSACTION_DELETED` must delete); **backfill
volume** (first run is the outlier — bound it); **member routing** correctness for
joint accounts (two deliveries, one row).

## 2. Ledger UI (accounts + transactions)

A read-only view over synced data — the first thing that makes ingestion visible.
Purely PostgREST + RLS (no new edge functions): the household already reads
`accounts` and `transactions` under RLS.

- **Accounts view** — list synced accounts (name, type, balance, owner/joint),
  reusing the account rows the Up-savers slice already populates. Likely folds
  into or extends the existing Net worth / Household surfaces rather than a wholly
  new tab.
- **Transactions view** — a paginated, filterable list from `public.transactions`
  ordered by `posted_at` desc: filter by account, date range, kind, status
  (pending vs settled), and (once mirrored) category. Show signed amount with the
  app's green/red money semantics, description, account, pending badge, member
  attribution tag.
- New nav tab (e.g. **Ledger** or **Transactions**), slotting into the existing
  `NAV_SECTIONS`-driven tab bar; mobile cards / desktop dense rows like Budget and
  Inflows.

Staged: ship the transactions list first (the whole point of sync); layer
filters/search and the accounts view after.

## 3. Reconcile actual spend vs budget

The budget is **plan-only and fortnightly** today: `budget_line` rows carry an
amount + frequency in fixed `budget_group`s (needs / wants / discretionary /
savings / investments), normalised to a fortnight, with no link to actual
transactions. Reconciliation adds an *actual* column beside the *planned* one.

The gap: **there is no link between Up categories and budget lines/groups.** A
budget line is a free-text purpose in a group; a transaction's category is Up's
fixed taxonomy. Bridging them is the core design problem (open question):

- **Category → group mapping.** Map each Up category (or parent) to a
  `budget_group`, so settled spend rolls up per group and compares against that
  group's planned fortnightly total. Coarse but immediately useful, and it only
  needs the category mirror from Stage 3 of sync.
- **Category → line mapping.** Finer: map categories (or rules over
  description/tag) to specific `budget_line`s. More powerful, more config; likely
  a later refinement.
- **Destination-account view.** Budget lines already route to a funding account
  (`destination_account_id`, or a goal's saver for Savings/Investments — see
  `pay-splits.md`). Actual spend *from* each account can be compared against the
  lines routed *to* it, giving a per-account planned-vs-actual without needing a
  category map at all. A pragmatic first cut.

Design decisions to settle: the reconciliation **period** (fortnight to match the
plan, or calendar month), whether **pending** spend counts, how **transfers** and
**income** are excluded (the `transfer` kind and positive `income` amounts should
not count as spend), and where actual-vs-planned surfaces (a column on the Budget
tab, an overlay on the Summary donut, or its own view).

Recommend the coarse **category→group** (or account-routed) rollup first, over
settled expense transactions, on the fortnightly period, surfaced beside the
existing planned totals. Defer per-line mapping and rules.

## 4. Actual PAYG tax paid vs estimate

Tax is **estimate-only** today (`@nest/tax`, per person, per FY). This layer
derives *actual* PAYG withheld from real data to compare against the estimate,
feeding a projected refund/bill.

Two possible sources (the **payslip** source, [`payslips.md`](payslips.md), is
the more accurate one):

- **Salary-credit transactions.** A salary deposit lands as an `income`
  transaction on a member's account. But Up sees only the **net** pay credited —
  the PAYG withheld and super never touch the Up account, so withheld tax **cannot
  be read directly** from a transaction. It could at best be *inferred*: net pay +
  the modelled gross/withholding from `@nest/tax` for that member's inflow, which
  is circular (it's the estimate, not the actual). Salary-credit transactions are
  useful for confirming **actual net pay received** (and thus validating the gross
  assumption), and for detecting pay-cadence/amount drift, but not for actual
  withheld tax.
- **Payslips (more accurate).** A payslip states gross, PAYG withheld, and super
  per pay period directly. If payslip capture is built ([`payslips.md`](payslips.md)),
  summing withheld across the FY gives true actual PAYG, and the refund/bill =
  actual withheld − estimated liability. This is the real source for this
  stage; the transaction path only corroborates net.

Design decisions (open questions): whether this phase ships on **salary-credit
inference** (approximate, needs only sync) or waits on a **payslip** source
(accurate, more work); how withheld is attributed to a member (via the inflow's
`member_id` and the account owner); and where the refund/bill estimate surfaces
(the Tax tab, beside the existing per-member breakdown). Recommend: identify and
tag salary-credit transactions now (cheap, corroborates net pay and the gross
assumption), and gate the actual-withheld number on the payslip source rather than
inferring it circularly from the estimate.

## Cross-cutting risks

- **Rate limits (`429`).** Backfill is the outlier: its window is bounded,
  pages are `page[size]=100`, and a `429` is retried after `Retry-After`.
  Steady-state incremental polls are one page per account.
- **Webhook security.** HMAC-SHA256 over the raw body, per-member `secretKey`,
  constant-time compare (already implemented); `verify_jwt = false` means the
  signature **is** the boundary — reject unsigned/mismatched. Migrate the single
  `UP_WEBHOOK_SECRET` to per-member Vault secrets.
- **Backfill of history.** An account's first run only, from the start of the
  prior financial year. All-time would be a separate on-demand action.
- **Idempotency.** `(source, external_id)` upsert + an overlap `since` window make
  re-delivery and re-poll safe; `HELD`→`SETTLED` is an in-place update;
  `TRANSACTION_DELETED` must delete the row.
- **Joint accounts.** A joint transaction fires two webhook deliveries and is seen
  by both tokens on poll; the upsert collapses to one row; `member_id` is null
  (mirrors the account). This is the same dedupe the account sync already proves.
- **`service_role` grants.** The poll and `up-categorise` write through
  SECURITY DEFINER RPCs and hold only `select` on `transactions`; a category
  mirror into `categories` would need its own deliberate grant or RPC, per the
  surgical grant policy ([`operations.md`](operations.md#service_role-grants)).

## Open questions (for the user to resolve later — not blocking)

1. **Webhook member routing** — per-member URL (id in path/query) vs
   try-all-secrets against a fixed URL. Recommend per-member URL.
2. **Webhook vs poll balance** — webhooks as primary with the hourly poll as
   backstop (recommended), or poll-only. How aggressively to rely on webhooks
   given delivery can fail.
3. **All-time history** — whether to offer an on-demand backfill past the prior
   financial year.
4. **Category mapping** — how Up categories map onto `budget_group` /
   `budget_line` for reconciliation (category→group vs category→line vs
   account-routed), once the category mirror fills `category_id`.
5. **Tags** — whether to ingest Up tags at all. No column today, and the gift
   use case is served by `external_category`, so nothing needs them yet.
6. **Pending spend** — does reconciliation count `HELD`/pending transactions or
   settled-only?
7. **Reconciliation period** — fortnight (matches the plan) vs calendar month.
8. **Actual PAYG source** — salary-credit inference (approximate, sync-only) vs a
   dedicated payslip source (accurate, its own phase). Recommend gating actual
   withheld on payslips; use transactions to corroborate net pay.
9. **Ledger UI placement** — a new Ledger/Transactions tab vs extending Net
   worth / Household.
