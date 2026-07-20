# Up ledger + reconciliation

The roadmap's current **Now** phase: pull actual Up transactions to reconcile
spend and tax against the plan. This is the heaviest phase, layered on top of the
plan-only app, Up savers, super, and gifts. It breaks into four ROADMAP
checkboxes:

- [ ] Account/transaction sync: webhook + scheduled poll; dedupe on `external_id`.
- [ ] Ledger UI (accounts + transactions) over synced data.
- [ ] Reconcile actual spend against the budget.
- [ ] Track actual tax paid (PAYG withheld) vs the estimate.

This doc plans them smallest-useful-first: transaction sync is the foundation,
then a read-only ledger UI over it, then the two reconciliation layers that
consume the synced data. Reconciliation is deferred behind sync deliberately —
neither layer is buildable until real transactions land in `public.transactions`.

## What already exists

The account-sync slice is built and deployed, and much of the transaction
scaffolding is already in place — this phase largely fills in TODOs rather than
starting cold.

- **`_shared/up.ts`** — a typed Up client (JSON:API, bearer per-member token). It
  already models `UpTransaction` (status `HELD`/`SETTLED`, `amount`, `createdAt`,
  `settledAt`, `account` + `category` relationships) and exposes
  `listTransactions(since?)` with `page[size]=100` + `filter[since]`, walking
  `links.next` to completion. It does **not** yet model `getTransaction(id)`,
  tags, `transferAccount`, `parentCategory`, or webhook registration.
- **`up-sync/map.ts`** — `mapTransaction(tx)` already maps an `UpTransaction` to a
  `TransactionUpsert` (`external_id`, `account_external_id`, `posted_at`,
  `amount_cents`, `description`, `kind` income/expense, `status`
  pending/settled, `source: 'up'`). It does **not** yet resolve `account_id`,
  `household_id`, `member_id`, `category_id`, or the `transfer` kind.
- **`up-sync/`** (index + sync) — accounts-only today. Two callers: a member's
  manual refresh (JWT, scoped to their household) and the hourly `pg_cron`
  service-role invocation (all households), told apart by the JWT `role` claim.
  Dedupes on `(source, external_id)`, collapses joint accounts to one shared row
  (`owner_member_id` null), attributes individual accounts to their owner, and
  prefixes individual spending-account names. Idempotent upsert.
- **`up-webhook/`** — deployed with `verify_jwt = false` (Up calls it
  unauthenticated) and a working `X-Up-Authenticity-Signature` HMAC-SHA256 check
  (`signature.ts`, constant-time compare). The handler switches on `PING` /
  `TRANSACTION_CREATED` / `TRANSACTION_SETTLED` / `TRANSACTION_DELETED` but the
  transaction branch is a **TODO** — it extracts the transaction id and returns
  `200` without persisting anything. It reads a single `UP_WEBHOOK_SECRET` env
  var (see the per-member-secret gap in Stage 1).
- **`public.transactions`** — the target table exists (`ledger_core.sql`):
  `household_id`, `account_id` (FK `(id, household_id)`), `member_id` (nullable
  attribution), `category_id` (nullable), `posted_at`, `amount_cents` (signed),
  `description`, `kind` (`income`/`expense`/`transfer`), `status`
  (`pending`/`settled`), `source` (`up`/`manual`), `external_id`, `notes`.
  `unique (source, external_id)`; RLS gates on household membership; indexed on
  household, account, category, posted_at. **Unpopulated today.**
- **`public.categories`** — hierarchical income/expense taxonomy per household
  (`parent_id`, `kind`, `is_archived`). Exists but unpopulated; not yet linked to
  Up's category taxonomy.
- **`service_role` grants** — surgical: `select` on `members`,
  `select`/`insert`/`update` on `accounts`. Transaction sync needs new grants
  (`insert`/`update`/`delete` on `transactions`; `select`/`insert` on
  `categories` if we mirror Up categories) — see the grant-policy open item in
  HANDOFF.

## Up API facts that shape the design

From <https://developer.up.com.au/> (base `https://api.up.com.au/api/v1`,
`Authorization: Bearer <token>`, read-only, JSON:API):

- **List:** `GET /transactions` and `GET /accounts/{id}/transactions`, newest
  first. Params: `page[size]`, `filter[since]` / `filter[until]` (RFC-3339),
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

### Scheduled poll — backstop (extend `up-sync`)

Webhooks can miss deliveries (downtime, Up outage, delivery failures visible in
`/webhooks/{id}/logs`), so the hourly `up-sync` cron must also pull transactions,
not just balances. Extend the existing run: after upserting accounts, for each
connected member call `listTransactions(since)` and upsert the mapped rows. This
reuses the entire two-caller model (manual JWT refresh scoped to a household; cron
service-role over all) and the per-member token read — no new invocation plumbing.

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

Extend `mapTransaction` (already exists for the base fields) and resolve the FKs
in the sync/webhook layer (the pure mapper stays I/O-free; FK resolution needs DB
lookups):

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
| `category_id` | from `tx.relationships.category` (+ `parentCategory`) — see below |

**Categories/tags.** Up's category is a fixed child-under-parent taxonomy;
`public.categories` is a per-household hierarchy that's currently empty. Options
(open question): (a) leave `category_id` null for now and add it in a later
sub-stage; (b) mirror Up's `GET /categories` into `public.categories` per
household (seeded once, `source`-tagged) and map each transaction's child +
parent onto it. Recommend deferring category mapping out of the first sync stage —
land transactions with `category_id` null, then add the Up-category mirror as its
own stage before spend reconciliation (which needs categories to group spend). Up
**tags** (custom labels, max 6) have no column today; defer entirely unless the
gift-tagging use case (ROADMAP "Later": Up-tagged gift purchases) pulls them
forward.

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

1. **Poll-only transaction sync.** Extend `up-sync` to pull + upsert
   transactions (bounded backfill on first run, derived-`since` incremental
   after), `category_id` null, `transfer` kind added to the mapper, `member_id`
   from account owner. New `service_role` grants on `transactions`. Reuses all
   existing cron/JWT plumbing — this alone populates the ledger.
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
  `NAV_ITEMS`-driven tab bar; mobile cards / desktop dense rows like Budget and
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

Two possible sources (cross-reference — a separate **payslip** doc may be added,
and would be the more accurate source):

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
  per pay period directly. If payslip capture is built (its own doc/phase),
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
- **`service_role` grants.** Sync needs new surgical grants (`transactions`, and
  `categories` if mirrored) — per the HANDOFF grant-policy stance, added
  deliberately.

## Open questions (for the user to resolve later — not blocking)

1. **Webhook member routing** — per-member URL (id in path/query) vs
   try-all-secrets against a fixed URL. Recommend per-member URL.
2. **Webhook vs poll balance** — webhooks as primary with hourly poll as
   backstop (recommended), or poll-only for simplicity to start (Stage 1 already
   is poll-only). How aggressively to rely on webhooks given delivery can fail.
3. **Backfill depth** — all-time vs bounded (current + prior FY). Recommend
   bounded; all-time on demand.
4. **Incremental cursor** — derived from `max(posted_at)` with an overlap window
   (recommended, no schema change) vs an explicit stored `up_sync_cursor`.
5. **Category mapping** — leave `category_id` null initially (recommended for the
   first sync stage), then mirror `GET /categories` into `public.categories`; and
   how Up categories map onto `budget_group` / `budget_line` for reconciliation
   (category→group vs category→line vs account-routed).
6. **Tags** — ingest Up tags now or defer until the Up-tagged-gift-purchase use
   case needs them (no column today).
7. **Pending spend** — does reconciliation count `HELD`/pending transactions or
   settled-only?
8. **Reconciliation period** — fortnight (matches the plan) vs calendar month.
9. **Actual PAYG source** — salary-credit inference (approximate, sync-only) vs a
   dedicated payslip source (accurate, its own phase). Recommend gating actual
   withheld on payslips; use transactions to corroborate net pay.
10. **Ledger UI placement** — a new Ledger/Transactions tab vs extending Net
    worth / Household.
