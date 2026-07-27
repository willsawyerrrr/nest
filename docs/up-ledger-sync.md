# Up ledger + reconciliation

An uncommitted, deprioritised roadmap phase (in **Later**): pull *all* actual Up
transactions to reconcile spend and tax against the plan. This is a large phase,
layered on top of the plan-only app, Up savers, super, and gifts. It breaks into
four ROADMAP checkboxes:

- [ ] Account/transaction sync: webhook + scheduled poll; dedupe on `external_id`.
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget.
- [ ] Track actual tax paid (PAYG withheld) vs the estimate.

This doc plans them smallest-useful-first: transaction sync is the foundation,
then a read-only ledger UI over it, then the two reconciliation layers that
consume the synced data. Reconciliation is deferred behind sync deliberately —
neither layer is buildable until real transactions land in `public.transactions`.

One narrow slice of the sync foundation is already shipped: the **gift-category
poll** (see below), which is all the Gifts screen needs to link a real card
purchase to a gift budget (the screen's own behaviour is in
[`breakdowns.md`](breakdowns.md#ui)). It is deliberately category-scoped, and its
only reader is that screen's candidate inbox — the general ledger below, and the
ledger UI over it, are what remains.

## What already exists

The account-sync slice and the gift-category transaction poll are built and
deployed, and much of the remaining scaffolding is in place — this phase largely
widens what is there rather than starting cold.

- **`_shared/up.ts`** — a typed Up client (JSON:API, bearer per-member token). It
  models `UpTransaction` (status `HELD`/`SETTLED`, `amount`, `createdAt`,
  `settledAt`, `account` + `category` relationships) and exposes
  `listTransactions({ since, category })` with `page[size]=100`, walking
  `links.next` to completion. It does **not** model `getTransaction(id)`, tags,
  `transferAccount`, `parentCategory`, `message`, or webhook registration.
- **`up-sync/map.ts`** — `mapTransaction(tx, accounts)` maps an `UpTransaction`
  onto the row the sync RPC takes (`household_id`, `account_id`, `member_id`,
  `external_id`, `external_category`, `posted_at`, `amount_cents`, `description`,
  `kind` income/expense, `status` pending/settled), resolving the account from a
  lookup the sync layer passes in and returning null — a skip — for an account
  that is not synced. It stays pure. It does **not** map `category_id`, `notes`,
  or the `transfer` kind.
- **`up-sync/`** (index + sync) — two passes per member, in order: every account's
  balance, then the member's gift-category transactions over a 365-day trailing
  window. Two callers: a member's manual refresh (JWT, scoped to their household)
  and the hourly `pg_cron` service-role invocation (all households), told apart by
  the JWT `role` claim. Accounts dedupe on `(source, external_id)`, collapsing
  joint accounts to one shared row (`owner_member_id` null), attributing
  individual accounts to their owner, and prefixing individual spending-account
  names. Idempotent throughout.
- **`up-webhook/`** — deployed with `verify_jwt = false` (Up calls it
  unauthenticated) and a working `X-Up-Authenticity-Signature` HMAC-SHA256 check
  (`signature.ts`, constant-time compare). The handler switches on `PING` /
  `TRANSACTION_CREATED` / `TRANSACTION_SETTLED` / `TRANSACTION_DELETED` but the
  transaction branch is a **TODO** — it extracts the transaction id and returns
  `200` without persisting anything. It reads a single `UP_WEBHOOK_SECRET` env
  var (see the per-member-secret gap in Stage 1). Gift ingestion does not depend
  on it, and cannot: no event fires on recategorisation.
- **`public.transactions`** — the target table exists (`ledger_core.sql`):
  `household_id`, `account_id` (FK `(id, household_id)`), `member_id` (nullable
  attribution), `category_id` (nullable), `external_category` (the source's own
  category), `posted_at`, `amount_cents` (signed), `description`, `kind`
  (`income`/`expense`/`transfer`), `status` (`pending`/`settled`), `source`
  (`up`/`manual`), `external_id`, `notes`. `unique (source, external_id)` and
  `unique (id, household_id)`; RLS gates each row on the balance-visible account
  set and withholds a row claimed as a gift for the caller
  (`hidden_gift_transaction_ids_for_current_member()`, which a general ledger
  inherits: the spend behind someone's surprise stays out of their ledger view
  too); indexed on household, account, category, posted_at. **Populated for the
  gift category only.**
- **`public.categories`** — hierarchical income/expense taxonomy per household
  (`parent_id`, `kind`, `is_archived`). Exists but unpopulated; not linked to Up's
  category taxonomy, so a synced row's `category_id` is null and its Up category
  sits in `external_category`.
- **`service_role` grants** — surgical: `select` on `members`,
  `select`/`insert`/`update` on `accounts` and on `account_balance`. There is no
  grant on `transactions`, and the gift poll wants none: it writes through the
  `sync_up_gift_transactions` SECURITY DEFINER RPC and resolves accounts under the
  `accounts` select. A general ledger that writes the table directly would need its
  own grants (`insert`/`update`/`delete` on `transactions`; `select`/`insert` on
  `categories` if Up categories are mirrored) — added deliberately per the
  surgical grant policy ([`operations.md`](operations.md#service_role-grants)) —
  or could route through an RPC the same way.

## Up API facts that shape the design

From <https://developer.up.com.au/> (base `https://api.up.com.au/api/v1`,
`Authorization: Bearer <token>`, read-only, JSON:API):

- **List:** `GET /transactions` and `GET /accounts/{id}/transactions`, newest
  first. Params: `page[size]`, `filter[since]` / `filter[until]` (RFC-3339, both
  bounding `createdAt` — not `settledAt`, so not `posted_at`),
  `filter[status]` (`HELD`/`SETTLED`), `filter[category]`, `filter[tag]`.
  Pagination is opaque cursors in `links.next` — follow until `null`, never
  construct URLs.
- **Single:** `GET /transactions/{id}` — the webhook path's fetch.
- **Transaction resource:** `status` (`HELD`/`SETTLED`), `amount`
  (`valueInBaseUnits` signed int cents), `description`, `message`, `rawText`,
  `createdAt`, `settledAt` (null while `HELD`), `isCategorizable`, `roundUp`,
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
  receiver must know whose token fetches it (see Stage 1 routing).
- **Rate limits:** `429` on throttle, `X-RateLimit-Remaining` header; retry with
  exponential backoff.
- **Categories:** `GET /categories` — non-paginated, fixed parent/child taxonomy
  (e.g. child `restaurants-and-cafes` under parent `good-life`). Child only can be
  assigned to a transaction.
- **Tags:** `GET /tags` — paginated custom labels, max 6 per transaction.

## 1. Transaction sync (foundation)

Two ingestion paths into `public.transactions`, both idempotent on
`(source='up', external_id)`, mirroring the account dedupe already built.

### Webhook — near-real-time (`up-webhook`)

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

### Gift-category poll (built)

The one ingestion path in production, and the shape the general poll can follow.
Per connected member, after the account pass: `listTransactions({ since,
category: 'gifts-and-charity' })`, map each transaction against the accounts just
upserted, and hand the whole result set to `sync_up_gift_transactions` — one call
per member, with `p_account_ids` set to the local ids of the accounts that
member's token can see and `p_since` to the window start. The RPC upserts the
window, holds a linked `gift_purchase` to its transaction's amount, and prunes the
gift-category rows the pass did not return.

Two properties are specific to a **category-scoped** poll and do not carry over to
the general ledger:

- **A rescanned window, not a cursor.** A transaction's category is not part of
  any cursor Up offers — no `updatedAt`, no event on recategorisation, and
  `filter[since]` filters on `createdAt`, which never moves. Since most gift spend
  is categorised by hand well after the purchase (Up files it under the merchant's
  category first), a cursor would step straight past the transactions the poll
  exists to find. Every run therefore rescans a fixed 365-day trailing window,
  which is a handful of pages once `filter[category]` has narrowed it. A year keeps
  a full annual cycle of occasions in scope.
- **A prune.** Recategorising a transaction away from gifts takes it out of the
  result set, and the prune takes it out of the inbox — except where a purchase
  links it (the household already claimed it). The prune is bounded by the same
  window, so a candidate that ages out is not deleted; it just stops being
  refreshed, and one recategorised away after ageing out lingers until dismissed
  as "not a gift". The two bounds are not quite the same instant, which is an
  accepted boundary case: `filter[since]` bounds Up's result on `createdAt` while
  the prune bounds on `posted_at` (`settledAt ?? createdAt`), so a transaction
  created just outside the window and settled just inside it is absent from Up's
  result yet within the prune's reach, and drops out of the inbox. It affects only
  the far edge of a year-old window, and never a transaction a purchase links to.

A general ledger needs neither: it ingests every category, so recategorisation
changes nothing about whether a row belongs, and nothing is ever pruned for
falling out of a filter. It can use the cursor strategy below.

### Scheduled poll — backstop (extend `up-sync`)

Webhooks can miss deliveries (downtime, Up outage, delivery failures visible in
`/webhooks/{id}/logs`), so the hourly `up-sync` cron must also pull transactions
across every category, not just balances and gifts. Extend the existing run: after
the account pass, for each connected member call `listTransactions({ since })` and
upsert the mapped rows. This reuses the entire two-caller model (manual JWT refresh
scoped to a household; cron service-role over all), the per-member token read, and
the account lookup the gift pass already builds — no new invocation plumbing.

**Incremental cursor / `since` strategy.** Don't refetch all history hourly. Track
a high-water mark per member (or per account) and pass it as `filter[since]`:

- Simplest: derive `since` from `max(posted_at)` of already-synced Up rows for
  that member's accounts (a query, no new column). Re-poll with a small overlap
  window (e.g. `since = max(posted_at) − 24h`) so late-settling `HELD`→`SETTLED`
  transitions and clock skew aren't missed; the upsert makes the overlap
  harmless.
- Or add an explicit `up_sync_cursor` (per member) column/table stamped each run.
  More moving parts; defer unless the derived approach proves insufficient.

`filter[since]` filters on `createdAt`, so a transaction that settles days after
creation is still caught by the overlap window, and its `status`/`settledAt`
update flows through the idempotent upsert.

### Backfill — history

A first sync (or a newly connected member) has no high-water mark, so it pulls
**all** transactions (`listTransactions()` with no `since`, paginating to
completion). This is the heaviest single operation and the main rate-limit risk.
How far back to backfill is an open question — Up retains full history; options
are all-time, or a bounded window (e.g. current + prior FY, which is all the tax
and budget reconciliation actually needs). Recommend a **bounded backfill by
`filter[since]`** to cap the first run, with all-time as a later on-demand action
if wanted.

### Field mapping (Up transaction → `public.transactions`)

`mapTransaction` already produces every column below except `category_id`,
`notes`, and the `transfer` kind. The account lookup it takes is resolved in the
sync layer, so the mapper stays I/O-free:

| `transactions` column | Source |
| --- | --- |
| `external_id` | `tx.id` |
| `source` | `'up'` |
| `account_id` | resolve from `tx.relationships.account.data.id` → the `accounts` row with `(source='up', external_id=<that id>)`; carry its `household_id` |
| `household_id` | from the resolved account |
| `member_id` | the resolved account's `owner_member_id` (null for joint — attribution mirrors the account) |
| `amount_cents` | `tx.attributes.amount.valueInBaseUnits` (already signed) |
| `posted_at` | `settledAt ?? createdAt` (as today) |
| `description` | `tx.attributes.description` |
| `notes` | `tx.attributes.message` (nullable) — optional |
| `status` | `SETTLED`→`settled`, `HELD`→`pending` |
| `kind` | `transferAccount` set → `transfer`; else `amount < 0` → `expense`, else `income` (adds the `transfer` case the current mapper omits) |
| `external_category` | `tx.relationships.category.data?.id` — the source's own category, carried on list responses |
| `category_id` | from `tx.relationships.category` (+ `parentCategory`) — see below |

**Categories/tags.** Up's category is a fixed child-under-parent taxonomy;
`public.categories` is a per-household hierarchy that's currently empty. A synced
row keeps Up's own child category verbatim in `external_category` (which is how
the gift poll recognises its candidates) and leaves `category_id` null. Options
for filling `category_id` (open question): (a) leave it null and add it in a later
sub-stage; (b) mirror Up's `GET /categories` into `public.categories` per
household (seeded once, `source`-tagged) and map each transaction's child +
parent onto it. Recommend deferring category mapping out of the first general sync
stage, then adding the Up-category mirror as its own stage before spend
reconciliation (which needs categories to group spend). Up **tags** (custom
labels, max 6) have no column; the gift use case is served by the category
instead, so tags stay unmapped.

**Pending vs settled.** Persist both from day one (the `status` enum already has
`pending`). A `HELD` transaction lands as `pending` with `posted_at = createdAt`;
when it settles, the next webhook/poll upserts it to `settled` with
`posted_at = settledAt`. The UI and reconciliation can then choose whether to
count pending spend (an open question — see reconciliation).

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

1. **Poll-only transaction sync.** Widen the poll from the gift category to every
   category (bounded backfill on first run, derived-`since` incremental after),
   `category_id` null, `transfer` kind added to the mapper, `member_id` from
   account owner. Reuses all existing cron/JWT plumbing, the mapper, and the
   account lookup — this alone populates the ledger.
2. **Webhook ingestion.** Per-member webhook registration on connect/disconnect,
   per-member secrets in Vault, fill the `up-webhook` TODO (fetch-map-upsert +
   delete). Poll becomes the backstop.
3. **Up-category mirror.** Seed `public.categories` from `GET /categories`, map
   `category_id` on sync. Prerequisite for spend reconciliation.

Risks for this section: **rate limits** on backfill (bound the window, paginate
politely, honour `429`/backoff); **webhook security** (HMAC per-member secret,
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
  actual withheld − estimated liability. This is the real source for the ROADMAP
  checkbox; the transaction path only corroborates net.

Design decisions (open questions): whether this phase ships on **salary-credit
inference** (approximate, needs only sync) or waits on a **payslip** source
(accurate, more work); how withheld is attributed to a member (via the inflow's
`member_id` and the account owner); and where the refund/bill estimate surfaces
(the Tax tab, beside the existing per-member breakdown). Recommend: identify and
tag salary-credit transactions now (cheap, corroborates net pay and the gross
assumption), and gate the actual-withheld number on the payslip source rather than
inferring it circularly from the estimate.

## Cross-cutting risks

- **Rate limits (`429`).** Backfill is the outlier; bound its window, paginate
  with `page[size]=100`, honour `X-RateLimit-Remaining` and back off. Steady-state
  incremental polls + webhooks are light.
- **Webhook security.** HMAC-SHA256 over the raw body, per-member `secretKey`,
  constant-time compare (already implemented); `verify_jwt = false` means the
  signature **is** the boundary — reject unsigned/mismatched. Migrate the single
  `UP_WEBHOOK_SECRET` to per-member Vault secrets.
- **Backfill of history.** First-run/first-connect only; decide how far back
  (recommend bounded by FY). All-time as a later on-demand action.
- **Idempotency.** `(source, external_id)` upsert + an overlap `since` window make
  re-delivery and re-poll safe; `HELD`→`SETTLED` is an in-place update;
  `TRANSACTION_DELETED` must delete the row.
- **Joint accounts.** A joint transaction fires two webhook deliveries and is seen
  by both tokens on poll; the upsert collapses to one row; `member_id` is null
  (mirrors the account). This is the same dedupe the account sync already proves.
- **`service_role` grants.** A direct-write sync needs new surgical grants
  (`transactions`, and `categories` if mirrored), or an RPC to write through as
  the gift poll does — either way deliberate, per the surgical grant policy
  ([`operations.md`](operations.md#service_role-grants)).

## Open questions (for the user to resolve later — not blocking)

1. **Webhook member routing** — per-member URL (id in path/query) vs
   try-all-secrets against a fixed URL. Recommend per-member URL.
2. **Webhook vs poll balance** — webhooks as primary with hourly poll as
   backstop (recommended), or poll-only for simplicity to start (Stage 1 already
   is poll-only). How aggressively to rely on webhooks given delivery can fail.
3. **Backfill depth** — all-time vs bounded (current + prior FY). Recommend
   bounded; all-time on demand.
4. **Incremental cursor** — derived from `max(posted_at)` with an overlap window
   (recommended, no schema change) vs an explicit stored `up_sync_cursor`. Either
   works for the general poll, where a row's membership never depends on a
   filter; the gift poll rescans a fixed window instead, for the reason given
   above.
5. **Category mapping** — leave `category_id` null initially (recommended for the
   first sync stage), then mirror `GET /categories` into `public.categories`; and
   how Up categories map onto `budget_group` / `budget_line` for reconciliation
   (category→group vs category→line vs account-routed).
6. **Tags** — whether to ingest Up tags at all. No column today, and the gift
   use case is served by `external_category`, so nothing needs them yet.
7. **Pending spend** — does reconciliation count `HELD`/pending transactions or
   settled-only?
8. **Reconciliation period** — fortnight (matches the plan) vs calendar month.
9. **Actual PAYG source** — salary-credit inference (approximate, sync-only) vs a
   dedicated payslip source (accurate, its own phase). Recommend gating actual
   withheld on payslips; use transactions to corroborate net pay.
10. **Ledger UI placement** — a new Ledger/Transactions tab vs extending Net
    worth / Household.
