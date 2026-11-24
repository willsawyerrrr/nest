# Up ledger + reconciliation

A phase (tracked in Linear): pull *all* actual Up transactions to reconcile
spend and tax against the plan. It is layered on top of the plan-only app, Up
savers, super, and gifts, and breaks into four stages:

- [x] Account/transaction sync: per-member webhooks for real-time ingestion,
  backed by a scheduled poll, deduped on `external_id`.
- [x] Ledger UI (accounts + transactions) over synced data: the transactions
  list and review screen (below) and the accounts view.
- [x] Reconcile actual spend against the budget.
- [x] Track actual tax paid (PAYG withheld) vs the estimate: payslips supply
  actual withholding, and Up salary credits corroborate each slip's net pay.

Transaction sync is the foundation; a read-only ledger UI sits over it, then the
two reconciliation layers that consume the synced data.

## What exists

The account sync, the transaction poll, webhook ingestion, and recategorising
from Nest are built and deployed.

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
  success, a `429` thrown rather than retried). `listWebhooks()`,
  `createWebhook(url, description)` (returning the id and its once-only
  `secretKey`) and `deleteWebhook(id)` (a `404` counts as deleted) manage the
  member's webhooks. It does **not** model tags.
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
- **`up-categorise/`** — recategorises one Up transaction, or a batch, from Nest (see
  [Recategorising from Nest](#recategorising-from-nest-up-categorise)). The MCP
  server's `categorise_transaction` tool calls it.
- **`up-webhook/`** — real-time ingestion (see [Webhook](#webhook--near-real-time-up-webhook)),
  deployed with `verify_jwt = false` (Up calls it unauthenticated); the
  member's own HMAC secret is the boundary. The flow is `handle.ts`.
- **`_shared/upWebhook.ts`** — per-member registration (see
  [Webhook registration](#webhook-registration)), shared by `up-connect` and
  `up-sync`.
- **`public.up_webhook`** — `member_id` (primary key, cascading from
  `members`), `webhook_id` (Up's id), `created_at`. Server-only: no
  `authenticated` grant or policy; `service_role` holds `select` and writes
  through `store_up_webhook` / `clear_up_webhook`, which keep the row and its
  Vault secret (`up_webhook_secret:<member_id>`, read only through
  `up_webhook_secret_for_member`) in step.
- **`public.transactions`** — `household_id`, `account_id` (FK
  `(id, household_id)`), `member_id` (nullable attribution), `category_id`
  (nullable), `external_category` (Up's child category),
  `external_parent_category`, `external_category_since` (when the sync first saw
  the current category), `posted_at`, `amount_cents` (signed), `description`,
  `kind` (`income`/`expense`/`transfer`), `status` (`pending`/`settled`),
  `source` (`up`/`manual`), `external_id`, `is_categorizable`,
  `transaction_type`, `deep_link_url`, `up_message`, `up_note`,
  `performing_customer_name`, and `notes`, `reviewed_at` and
  `reviewed_by_member_id` — the household's own, which the sync never writes and
  members set through `review_transaction`, their only write path to the
  table. `unique (source, external_id)` and `unique (id, household_id)`;
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
  `select` on `transactions` and `up_webhook`. `transactions`, `up_category` and
  `up_webhook` are written only through the `sync_up_transactions`,
  `delete_up_transactions`, `sync_up_categories`, `set_up_transaction_category`,
  `store_up_webhook`, and `clear_up_webhook` SECURITY DEFINER RPCs, so
  `service_role` holds no write grant on any of them (per the surgical grant policy,
  [`operations.md`](operations.md#service_role-grants)).

## Up API facts that shape the design

From <https://developer.up.com.au/> (base `https://api.up.com.au/api/v1`,
`Authorization: Bearer <token>`, JSON:API). The API is read-only except for a
transaction's category and tags and for webhooks:

- **List:** `GET /transactions` and `GET /accounts/{id}/transactions`, newest
  first. Params: `page[size]`, `filter[since]` / `filter[until]` (RFC-3339, both
  bounding `createdAt`, which `posted_at` holds),
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
  user).** A delivery's body carries only the transaction id, not the member — so
  each member's webhook URL names them (see member routing below).
- **Rate limits:** `429` on throttle, `X-RateLimit-Remaining` header; the
  client retries after `Retry-After`, else with exponential backoff.
- **Categories:** `GET /categories` — non-paginated, fixed parent/child taxonomy
  (e.g. child `restaurants-and-cafes` under parent `good-life`). Child only can be
  assigned to a transaction. Mirrored into `up_category` each sync run.
- **Tags:** `GET /tags` — paginated custom labels, max 6 per transaction.

## 1. Transaction sync (foundation)

Ingestion into `public.transactions` is idempotent on `(source='up',
external_id)`, mirroring the account dedupe. Webhooks land a transaction within
seconds; the hourly poll is the backstop for any delivery that never arrives.

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
- An account with `ledger_resync_pending` re-reads from that same backfill start
  instead of its mark, re-landing every row it holds, and the flag clears once
  the rows land. A migration sets it to rewrite stored rows after a mapping
  change, without manual SQL.

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
is not caught (no webhook event fires for it either); nothing reads those categories until the category mirror
(stage 3). A recategorisation made from Nest is recorded on the row at once (see
below).

**`sync_up_transactions(p_household_id, p_rows)`** upserts on `(source,
external_id)` and returns `table(id, inserted)` (`xmax = 0` on a fresh insert),
which is what prompts review of a newly arrived transaction (see
[Review prompt](#review-prompt-on-first-sight)). It never writes `notes`,
`reviewed_by_member_id`, `category_id`, or `created_at`, and sets `reviewed_at`
only on insert, to now for a `Salary`, `Interest` or `Transfer` transaction
(pay, interest, and transfers and covers, needing no decision), so a later sync never reviews or un-reviews a row; it restamps `external_category_since` only when
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
   category but the row keeps the old one. No sync corrects it (the ledger pass
   re-reads only about the last day, and Up raises no event on a
   recategorisation), so the caller retries; setting the same category on Up
   again is idempotent.

`{ transaction_ids, category_id }` (1–100 distinct ids) recategorises a batch
with one category and one token read. An unknown or parent category, or no
token, fails the whole request as above; otherwise it answers `200` with
`results`, each `{ transaction_id }` or `{ transaction_id, code }` in request
order. Each transaction is read, checked and written in turn, one Up call at a
time; a `429` is retried after Up's `Retry-After` (else exponential backoff),
up to three times. Once a failure that holds for the whole token is seen —
`up_auth_failed`, or `up_rate_limited` those retries did not clear — the rest
report it without another call to Up. Any other failure is that transaction's
alone.

### Transactions list (`/transactions`)

The PWA's **Transactions** screen (Review nav group; `routes/TransactionsSection.tsx`,
`components/TransactionListScreen.tsx`, `hooks/useTransactionList.ts`,
`lib/transactionList.ts`) lists every transaction the signed-in member can see —
any source, status, kind, or review state — newest first (`posted_at`, then
`id`), 50 at a time through `.range()` with a **Load more** button. RLS limits
it to the member's balance-visible accounts, so a co-member's own spending
account never appears.

Filters run server-side and live in the URL's search params, so a filtered view
is linkable: `account` (an `account_directory` id), `from` and `to` (local
dates, `to` inclusive — compared against `posted_at` from local midnight),
`kind` (`income` / `expense` / `transfer`), `status` (`pending` / `settled`),
and `category` (an Up category id: a parent matches its children through
`external_parent_category`; `none` matches uncategorised rows). A malformed
value is ignored. **Clear filters** resets them all.

Rows are the review screen's rows, plus a tag naming whose transaction it is:
the account owner's name (`member_id`), or `Joint` for a joint account, naming
Up's `performing_customer_name` where present (`Joint · $alex`). Expanding a row
opens the same review form — category, Nest note, **Looks right**, **Save**,
**It's a gift**, **Create deduction** — for any transaction: `review_transaction`
takes any visible row, and the category picker is disabled where the row is not
categorisable (a transfer, a non-Up row). A review refreshes the list. Wide
screens show dense rows, narrow ones compact cards.

### Reviewing transactions (`/transactions/review`)

The PWA's review screen (`routes/TransactionReviewSection.tsx`,
`components/TransactionReviewScreen.tsx`, `hooks/useTransactionReview.ts`)
lists the signed-in member's unreviewed Up transactions (`source = 'up'`,
`reviewed_at` null, and `is_categorizable`), newest first and capped at the
newest 100, as the native app and MCP's `unreviewed` filter list them. A
`Salary`, `Interest` or `Transfer` transaction arrives reviewed (by no member),
so no transfer or cover awaits review: between the household's own accounts, a
cover or forward from a saver, or from someone else (e.g. `Transfer from
$friend`, which lands as `kind = 'income'`). Other incoming payments
(`Direct Credit`, `Osko Payment Received`) await review. RLS already limits them to the member's
balance-visible accounts. It sits under To review in the nav's Review group, and `?id=<transaction id>` leads with that transaction, expanded and
scrolled to, even once it is reviewed (what a notification opens). The same
rows and review form appear on the [transactions list](#transactions-list-transactions),
which shows every transaction rather than only those awaiting review.

Each row (`components/TransactionRow.tsx`, shared with the transactions list)
shows the description, signed amount, account, date, a `Pending` pill while Up
holds it, a `Transfer` pill for a transfer, its Up category (`Parent › Child` from `up_category`), and
Up's own note and message, read-only — Up's API cannot write either. Expanding
a row offers a category picker (Up's child categories grouped by parent) and
the household's own note, prefilled from `notes`, with three actions:

- **Looks right** — `review_transaction` with the note, marking it reviewed.
  Disabled while the picker holds a different category.
- **Save** — when the category changed, `up-categorise` first, then
  `review_transaction` with the note; enabled once the category or note differs.
- **It's a gift** — `up-categorise` to `gifts-and-charity`, then
  `review_transaction`, and a notice linking to Gifts, whose inbox lists it.

An outflow (negative `amount_cents`) with no deduction yet also offers **Create
deduction**, opening `/deductions?transaction=<id>` on the Deductions screen:
the signed-in member's add form, prefilled with the transaction's description
(or `Card purchase` when unnamed), its absolute amount, its local payment date,
and the financial year that date falls in. The member picks the category,
basis, and work use as usual; a donation still files into the Donations group,
and a receipt can still be attached. Saving stores `deduction.transaction_id`.
A transaction that has a deduction shows a `Deduction` pill and no button, and
the database refuses a second deduction on it. The deduction shows
`From <description> · <date>` beneath its row.

Every row with a `deep_link_url` also carries **Open in Up**: Up's API exposes
no cover data, so fixing a cover happens in Up. A refused category change leaves
the transaction unreviewed and renders Nest's own copy per `up-categorise` code
(`up_not_connected` and `up_auth_failed` link to Connections). That includes
`save_failed`: Up took the category but Nest's copy did not, so the transaction
stays unreviewed with the picker's choice kept, and saving again retries.

Each unreviewed row has a checkbox, and a bar above the list selects all of
them (every unreviewed row the screen shows), counts the selection, and acts on
it:

- **Mark reviewed** — `review_transaction` for each, a few at a time, leaving
  each note as it is.
- **Set category** + **Apply** — `up-categorise`'s batch form (100 per
  request), then `review_transaction` for each one Up and Nest both took. A move
  into `gifts-and-charity` shows the Gifts notice.

A transaction either step fails stays unreviewed and selected, and an alert
names each one with Nest's copy for its code (linking to Connections where that
is the fix). The rest leave the list.

### Webhook — near-real-time (`up-webhook`)

**Member routing: per-member URL.** Each member's webhook delivers to
`up-webhook?m=<member_id>`. The handler reads `m`, loads that member's secret
from Vault (`up_webhook_secret_for_member`), and verifies the
`X-Up-Authenticity-Signature` HMAC-SHA256 over the raw body (`signature.ts`,
constant-time compare) before reading anything else. An unknown member, a
missing secret, and a bad signature are the same bare `401`; the id is opaque,
so a guessed one buys nothing without the secret.

- `PING` → `200`.
- `TRANSACTION_CREATED` / `TRANSACTION_SETTLED` → `getTransaction` with the
  member's Vault token, `mapTransaction` against the member's household's
  account (a transaction on an account not yet synced is skipped for the poll to
  land), and `sync_up_transactions`. The ids the upsert newly inserted prompt
  their review (below).
- `TRANSACTION_DELETED` → `delete_up_transactions`, which keeps a row a gift
  purchase links.

A failure redelivery could fix (the database, an Up outage or rate limit) is a
`500`, so Up retries; one it could not (a token Up rejects, a member gone, a
transaction Up no longer has) is acknowledged with a `200` and logged. A signed
body that is not a valid event is a `400`.

A joint account is visible through both partners' tokens, so a joint
transaction fires **two** deliveries, one per member's webhook. The
`(source, external_id)` upsert collapses them to one row, attributed
`member_id` null from the account, as the poll does.

### Review prompt on first sight

Both ingestion paths hand the rows `sync_up_transactions` reports newly inserted
to `promptReviewOfInserted` (`_shared/notifyClient.ts`) — the poll once per
household after its members sync, the webhook per delivery — which sends a
`transaction_review` push through the shared delivery loop
(`_shared/notify.ts`). Best effort: a failure is logged and costs the ingestion
nothing, and `notify-eval` re-evaluates the last 2 days daily as a backstop. The
dedupe key is the transaction id, so whichever path runs first is the only one
to send.

- **Which rows.** `is_categorizable` (so transfers, round-ups and covers are
  skipped; pending holds are included), unreviewed (so pay and interest, which
  arrive reviewed, are skipped), and dated by Up
  (`posted_at`) within 48 hours of the ledger's first sight (`created_at`), so a
  backfill of history is never announced. A row a gift purchase links is
  skipped.
- **Who.** An individual account's owner. A joint account's transaction goes
  only to its purchaser, so a gift bought on it never pings its recipient. Up's
  `performingCustomer.displayName` is the customer's Up handle (`$alex`), not
  their Nest name, so `up_customer_handles` learns each member's handles from
  their own individual accounts — where every transaction is theirs — and a
  handle seen on exactly one member names them. A member with no handle on
  record matches on a whole or first name equal to the handle without its `$`.
  Without exactly one match nobody is notified, and the skip is logged.
- **Opt-in.** An absent `notification_preference` row means off for this
  trigger alone; the same toggle shows the Summary's "N to review" card.
- **Payload.** `Myer · $42.10` / `Clothing & Accessories — right category?`
  (the `up_category` name), opening `/transactions/review?id=<id>`.

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
| `posted_at` | `createdAt` — when the payment was made; settlement never moves it |
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
| `reviewed_at` | on insert only: now for `transaction_type` `Salary`, `Interest` or `Transfer`, else null; never written on update |
| `notes`, `reviewed_by_member_id` | never written — the household's own |
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
`pending`; when it settles, the webhook or the next poll upserts it to
`settled`. `posted_at` is `createdAt` throughout, so a transaction is always
dated by when the payment was made. A hold Up drops without settling
(`TRANSACTION_DELETED`) is deleted by its webhook delivery, or by the gift rescan
in the gift category; one whose delivery never arrives stays `pending`. The UI
and reconciliation can then choose whether to count pending spend (an open
question — see reconciliation).

### Webhook registration

`registerWebhook` (`_shared/upWebhook.ts`) is idempotent and runs:

- in `up-connect`, once the token is stored — best effort, so a failure leaves
  the member connected;
- in `up-sync`, for each connected member whose token lists their accounts but
  who has no `up_webhook` row — best effort, never failing the run, which also
  registers members connected before registration existed.

It reads `GET /webhooks` and keeps a Nest webhook only when it is the stored one
at the member's exact URL; any other pointing at `up-webhook` is deleted, since
Up returns a secret only at creation and Nest has none for it. It creates one
only when Up's 10-per-user cap leaves room after those deletes, storing the
returned `secretKey` and id through `store_up_webhook`; a created webhook whose
store fails is deleted again. `up-disconnect` deletes the webhook at Up (best
effort) and clears the row and secret through `clear_up_webhook`, before
clearing the token.

### Stages (smallest-useful-first)

1. **Poll-only transaction sync (built).** Every category, a bounded backfill on
   an account's first run and a derived per-account `since` after,
   `category_id` null, the `transfer` kind, `member_id` from the account owner.
   This populates the ledger.
2. **Webhook ingestion (built).** Per-member webhook registration on connect,
   disconnect, and sync; per-member secrets in Vault; fetch-map-upsert and
   delete per delivery. The poll is the backstop.
3. **Up-category mirror.** Seed `public.categories` from `GET /categories`, map
   `category_id` on sync. Prerequisite for spend reconciliation.

Risks for this section: **rate limits** on backfill (bounded window,
`page[size]=100`, `429` retried after `Retry-After`); **webhook security** (HMAC per-member secret,
constant-time compare; reject unsigned/mismatched);
**idempotency** (the `(source, external_id)` upsert + overlap window make
re-delivery and re-poll safe; `TRANSACTION_DELETED` must delete); **backfill
volume** (first run is the outlier — bound it); **member routing** correctness for
joint accounts (two deliveries, one row).

## 2. Ledger UI (accounts + transactions)

A read-only view over synced data — the first thing that makes ingestion visible.
Purely PostgREST + RLS (no new edge functions): the household already reads
`accounts` and `transactions` under RLS.

- **Accounts view (built)** — `/accounts` ("Accounts", in the Grow nav group
  after Net worth) lists every row of `accounts_with_balance` the member can see
  — joint, their own, and the household's super; a co-member's own accounts are
  hidden by RLS — grouped by type (Spending, Savings, Offset, Credit, Home loan,
  Other) with each group's summed balance. Type groups rather than owner groups,
  because RLS leaves a co-member's group holding only their super, while a
  per-type total (cash on hand, debt owed) is a figure worth reading; the owner
  is a per-row tag instead. Each account shows its Up icon and name, owner
  (member or "Joint"), source (Up, Redbark or Manual), balance (red when
  negative, as a credit card or home loan is) and badges for "Deleted at
  source" and "Not in net worth". Mobile cards, desktop dense rows. Read-only:
  net-worth inclusion is set on Net worth. Labels and grouping live in
  `apps/pwa/src/lib/accounts.ts`, mirrored natively by `AccountsPresentation`
  (see [`native-screens.md`](native-screens.md#accounts)).
- **Transactions view (built natively)** — the native app's `/transactions`
  ("Transactions", in the Plan nav group): a paginated list from
  `public.transactions` ordered by `posted_at` desc, filtered by account, date
  range, kind, status (pending vs settled) and Up category, each row showing the
  signed amount in the app's green/red money semantics, description, account,
  date, category, pending pill and member attribution tag, and expanding to the
  review form; mobile cards, desktop dense rows. See
  [`native-screens.md`](native-screens.md#transactions).

## 3. Reconcile actual spend vs budget

The native Budget screen shows each group's actual spend for a fortnight beside its planned
fortnightly subtotal: what was spent, and what is left or by how much it went
over. The plan stays plan-only — nothing about a line or the buffer moves with
spend.

### Decisions

- **Category → group mapping.** Each Up child category counts toward one
  `budget_group`. `up_category_default_group` holds a seeded default shared by
  every household (essentials such as groceries, rent, utilities, fuel and
  health → Needs; dining, streaming, clothing, travel and gifts → Wants; bars,
  booze, events, hobbies and gambling → Discretionary; `investments` →
  Investments; nothing → Savings). `up_category_group` holds a household's
  override per category, including a null group that counts it toward none;
  no row falls back to the default. Group-level mapping is coarse but needs no
  configuration to be useful. Per-line mapping and description rules are a
  later refinement, and the destination-account view was set aside because
  spend from one account rarely belongs to the lines routed to it alone.
- **Period: the pay-cycle fortnight.** The plan is fortnightly, so the
  reconciled period is a fortnight, on a 14-day grid stepped from the
  household's earliest confirmed payday (`pay_anchor_date`) among its recurring
  salary and wage inflows, else from the calendar feed's `2020-07-01` epoch
  (`payCycleAnchor`, `spendFortnight` in `@nest/plan`). A fortnight therefore
  opens on a payday. Planning mode never moves the grid: it reads the real
  inflows. The screen opens on the fortnight holding today and steps back through
  earlier ones.
- **Days are local.** A transaction counts on its `posted_at` date in the
  household's `timezone`, so a purchase at 11pm counts that day.
- **Settled spend by default.** A held transaction can still change amount or
  drop, so only settled spend counts unless the member turns on "Include
  pending" for the view.
- **What counts as spend.** A row with an Up category counts whatever its sign,
  so a refund back into a category nets off that category's spend. An
  uncategorised `expense` (a Pay Anyone or BPAY payment, say) counts as spend
  in no group. `kind = 'transfer'` never counts: every move between the owner's
  own accounts — round-ups, covers from a saver, saver transfers — carries
  Up's `transferAccount` and lands as a transfer. Uncategorised income (pay, a
  transfer in from someone else) never counts.
- **Spend in no group is shown, not hidden.** Spend in a category mapped to
  none, and uncategorised spend, total to one "in no group" figure on the screen,
  so remapping a category never makes money silently disappear.
- **Privacy.** `budget_actual_spend` is SECURITY INVOKER, so the
  `transactions` policies apply: the figure covers the accounts the member can
  see, never a co-member's private spending account, and never a gift claimed
  for them. The two partners can therefore see different actuals beside the
  same plan.

### Implementation

- `budget_actual_spend(p_start date, p_end date, p_include_pending boolean
  default false)` returns `(line_group, spent_cents)`, one row per group with
  spend and a null `line_group` row for spend in no group.
- The native Budget screen (`apps/ios/Nest/Screens/Budget`) reads it.
  `ActualSpendViewModel` reads the household's stored `inflows` (never the
  planning sandbox), asks the engine's `spendFortnight` entry
  (`payCycleAnchor` + `spendFortnight`) for the fortnight at the chosen offset,
  then calls the RPC through `NestData.rpcRows` (cached first under
  `budget_actual_spend`, keyed by its arguments) and folds the rows with the
  engine's `actualSpend` entry (`actualSpendByGroup`). `ActualSpendBar` renders
  the fortnight, its steppers, the "Include pending" switch, the in-no-group
  total and the Category groups button above the groups; each group card shows
  spent and left or over beneath its subtotal (`GroupSpendLine`, copy in
  `ActualSpendPresentation`).
- `CategoryGroupsSheet` (`CategoryGroupsViewModel`) lists `up_category`'s child
  categories under their parents with `up_category_default_group` and the
  household's `up_category_group` rows. Picking a group or "No group" upserts
  the override (a null `line_group` for none); picking "Default (…)" deletes it.
  Each write drops the cached `budget_actual_spend` results, and closing the
  sheet reloads the spend.
- The PWA's Budget tab reads it through `useActualSpend` (`BudgetSection`
  steps the fortnight with `payCycleAnchor` / `spendFortnight` from `@nest/plan`
  over the stored inflows and folds the rows with `actualSpendByGroup`).
  `ActualSpendBar` renders the fortnight, its steppers, the "Include pending"
  switch, the in-no-group total and the Category groups button above the
  groups; each `GroupSection` shows spent and left or over beneath its
  subtotal. `CategoryGroupsModal` (`useCategoryGroups`) maps categories to
  groups with the same default, group, or no-group choices.

## 4. Actual PAYG tax paid vs estimate

Actual PAYG withheld comes from payslips ([`payslips.md`](payslips.md)): each
member's summed slip tax (`paygWithheldFromRows`) nets against the estimate's
liability as a refund or bill on the Tax and EOFY screens. Up cannot supply it —
it sees only the **net** pay credited; PAYG and super never touch the account.

What Up does supply is **salary-credit corroboration**, shown on the Payslips
screen: the credit that carried each slip, how its amount stands against the
slip's net and the plan's net, and each member's pay as it landed, with drift
from the pay cycle and from the previous pay. It is derived on read
(`corroborateNetPay` in `@nest/plan`), nothing is stored, and it never feeds the
tax figures.

### Which credits are salary

The candidates are the household's visible `income` transactions with a positive
amount, loaded from a day before the financial year to eight days past it. A
credit is tagged as a member's salary in three ways, in order:

1. **Matched to a payslip.** On the member's own account or a joint one (pay
   commonly lands in the joint pay account, attributed to nobody), within the
   slip's window — a day before to three days after `paid_on` (early processing,
   weekends, public holidays), or the week after `period_end` for a slip stating
   no payment date — and within 10% of the slip's net. Pairs are assigned closest
   amount first, then closest day, each credit and slip once.
2. **From the member's payer.** A credit whose description (case and whitespace
   ignored) also paid one of the member's matched credits, on their own or a joint
   account: the pays they entered no slip for. A payer whose credits matched both
   members' slips is nobody's.
3. **Up's `Salary` type.** A credit Up types as salary, on the member's own
   account, or on a joint one in a one-member household. In a household of two a
   joint salary credit matching no payer is unattributed, and the screen names its
   payer and asks for one of the payee's slips, which links every credit from it.

### What is measured

- **Slip vs credit.** `matched` within $1 of the slip's net (rounding), `differs`
  beyond it with the difference, `missing` where no credit qualifies. The plan's
  net is the slip's expected gross less its expected withholding; the credit's
  difference from it shows where the slip's variance has one.
- **Cadence drift.** The pay cycle is the most common period length across the
  member's slips, else the median gap between their credits (three or more). A
  gap more than three days off it is flagged.
- **Amount drift.** A credit more than 10% above or below the previous one is
  flagged.

The PWA hides all of it when the household has no credits (no Up connection).

## Cross-cutting risks

- **Rate limits (`429`).** Backfill is the outlier: its window is bounded,
  pages are `page[size]=100`, and a `429` is retried after `Retry-After`.
  Steady-state incremental polls are one page per account.
- **Webhook security.** HMAC-SHA256 over the raw body, per-member `secretKey`
  in Vault, constant-time compare; `verify_jwt = false` means the signature
  **is** the boundary — unsigned/mismatched is rejected.
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

1. **All-time history** — whether to offer an on-demand backfill past the prior
   financial year.
2. **Tags** — whether to ingest Up tags at all. No column today, and the gift
   use case is served by `external_category`, so nothing needs them yet.
3. **Ledger UI placement** — a new Ledger/Transactions tab vs extending Net
   worth / Household.
