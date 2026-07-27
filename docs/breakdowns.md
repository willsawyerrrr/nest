# Breakdowns

A **breakdown** is a user-created, household-scoped itemised list whose items roll
up into a derived budget line (labelled a **budget item** in the UI; "line"
persists in the `budget_line` schema only). The household creates arbitrary
breakdowns; a breakdown owns one real budget line whose amount is the sum of its
items, so the line and its detail are one source of truth and never drift.
Breakdowns are generic-only — medications and any other itemised budget are
breakdowns defined as data, not hardcoded enum cases.

Gift budget lines are a **separate standalone roll-up**, not a breakdown: they are
keyed by `budget_line.is_gift_line` and derived directly from the gift tables
(`gift_budget` + `gift_recipient`) by the reconcile pass, with `breakdown_id` null
and no breakdown row of any kind. Their design — recipient partitioning, naming,
buyer-account funding, per-line groups, and privacy — is described alongside the
generic breakdown below, since both feed derived `budget_line` rows.

Amounts are integer minor units (cents). Every item carries an amount + frequency,
normalised to fortnightly and annual exactly as a budget line is.

## Decisions (locked)

- **Breakdowns are data, not an enum.** Any itemised budget the household wants —
  medications, a holiday's line items — is a generic breakdown row it creates in the
  Breakdowns tab, names, and assigns to a budget group. There is no fixed catalogue
  of sources and no migration per new source. Gifts are a separate built-in roll-up,
  keyed by `budget_line.is_gift_line` and derived from the gift tables, not a
  breakdown.
- **A breakdown owns one derived line; the gift roll-up owns one per recipient
  partition.** A rolled-up line is a real, routable `budget_line` row (it
  participates in the Pay splits tab's account routing like any line). A breakdown
  owns exactly one line whose group, name, and amount come from the breakdown. The
  gift roll-up instead splits by recipient: one derived line per household member who
  has gift budgets — named "Gifts for &lt;member&gt;" and discriminated by
  `budget_line.gift_recipient_member_id` — plus one line named "Gifts" for all
  external (non-member) recipients (the null discriminator). Every gift line carries
  `is_gift_line = true` and no `breakdown_id`. Each gift line carries its own
  recipient partition's total and its own budget group: a gift line's group is set
  per line and preserved across reconcile (a brand-new gift line seeds to Wants), so
  "Gifts (others)" can sit in Discretionary while "Gifts for &lt;member&gt;" lines are
  Wants. A breakdown line's group instead follows its breakdown. A
  "Gifts for &lt;member&gt;" line is funded automatically from the **buyer's** — the
  other partner's — spending account, not user-configurable; the external gift line
  and every breakdown line keep a user-set funding account. A line's amount is
  read-only and system-managed in every case.
- **The line exists only when there is something to roll up.** A generic breakdown
  with no items has no budget line, and a gift recipient partition with no gift
  budgets has no line. A line is created when the first item/budget in its partition
  lands and removed when the last goes, so an empty breakdown or partition never
  shows a $0 line in the budget.
- **Breakdowns are `generic`-only.** Every breakdown row is `kind = 'generic'` and
  rolls up its `breakdown_item` rows via a simple item editor. The `breakdown_kind`
  enum retains a `gift` value, but it is retired and unused — no `gift` breakdown
  rows exist; gifts roll up directly from the bespoke `gift_*` tables via
  `is_gift_line`.
- **Derived lines are never created from the budget form.** The budget-line form has
  no "Amount source" picker; a derived line comes into being only through its
  breakdown.
- **Gifts are managed solely in the Gifts tab.** The gift planner uses its own UX
  and its `gift_recipient` / `gift_occasion` / `gift_budget` / `gift_purchase`
  tables, all household-scoped. The reconcile pass turns the gift budgets directly
  into the derived "Gifts for &lt;member&gt;" / "Gifts (others)" budget lines (keyed
  by `is_gift_line`, with no breakdown row); gifts never appear in the Breakdowns
  tab. The Breakdowns tab is generic-only.
- **A gift's budget is shared; its purchases are private from the recipient.**
  The two partners set a gift's agreed amount together, so `gift_budget` stays
  fully shared and continues to feed the derived lines and pay splits.
  What must stay hidden — so the surprise is not spoiled — is the purchases and the
  spent/remaining they derive. A `gift_recipient` can be linked to a household
  member (`gift_recipient.member_id`): when it is, that member is the recipient,
  and their gift's purchases and progress are hidden from them (in the database via
  RLS on `gift_purchase`, and in the Gifts screen, which shows only the agreed
  budgeted amount plus a note). The recipient may still edit that shared agreed
  amount — RLS on `gift_budget` permits it and the Gifts screen offers the edit
  control — since the budget is jointly planned; only the spend stays hidden. Any
  other member — the buyer — sees everything.
  A purchase linked from a synced Up transaction is hidden by that same policy, and
  so is the transaction behind it: on top of the ledger's per-account rule
  (`visible_balance_account_ids()`, which keeps a gift bought on the buyer's own
  spending account out of the recipient's sight entirely), the `transactions`
  policies exclude
  `hidden_gift_transaction_ids_for_current_member()` — the spend claimed as a gift
  for the caller. A gift bought on the joint account is therefore a candidate for
  both partners while it is unclaimed, and claiming it for one of them withholds it
  from that member, so no account choice is needed to keep a surprise intact. An
  unlinked recipient is an external person, fully shared — a
  joint-account purchase for them stays visible to both.
- **Every household member is a permanent recipient.** A member's recipient is
  auto-created with the member and removed with them, and cannot be renamed or
  deleted (enforced in the database by an insert trigger, an `on delete cascade`
  FK, a one-per-member unique index, and an update guard). The Gifts screen lists
  the members first as fixed rows; adding a recipient is for external people only.
- **Medications is a generic breakdown.** There is no bespoke Health tab or
  medication schema; the household creates a generic breakdown and lists its
  medications as items.

## Data model

Two tables plus the derived-line columns on `budget_line`, mirroring the gift
tables' conventions — composite `(id, household_id)` keys, RLS on household
membership, a `set_updated_at` trigger, and explicit grants.

### `breakdown`

- `id uuid primary key default gen_random_uuid()`
- `household_id uuid not null references public.households on delete cascade`
- `name text not null` — the rolled-up line's name.
- `line_group public.budget_group not null` — the budget group the rolled-up line
  belongs to. Each breakdown specifies its own group.
- `kind public.breakdown_kind not null default 'generic'` — always `'generic'`,
  reading `breakdown_item`.
- `created_at` / `updated_at timestamptz not null default now()`
- `unique (id, household_id)` — the composite key children reference.

The enum `create type public.breakdown_kind as enum ('generic')` backs `kind`;
`'generic'` is its only value.

### `breakdown_item`

Owned by a breakdown; every breakdown is generic.

- `id uuid primary key default gen_random_uuid()`
- `household_id uuid not null references public.households on delete cascade`
- `breakdown_id uuid not null`, with composite FK
  `foreign key (breakdown_id, household_id) references public.breakdown (id, household_id) on delete cascade`
- `name text not null`
- `amount_cents bigint not null`
- `frequency public.frequency not null`
- `interval_count int` — with the same CHECK as `budget_line`: set (≥ 1) only when
  `frequency in ('every_n_weeks', 'every_n_months')`, null otherwise; its unit
  (weeks or months) is read from the frequency.
- `created_at` / `updated_at timestamptz not null default now()`

### `budget_line.breakdown_id`

- `breakdown_id uuid`, with composite FK
  `foreign key (breakdown_id, household_id) references public.breakdown (id, household_id) on delete cascade`.
- A budget line with a non-null `breakdown_id` is a **derived line** owned by that
  breakdown; a null `breakdown_id` is an ordinary manual line, or — when
  `is_gift_line` is true — a gift-derived line (see below).

### `budget_line.is_gift_line`

- `is_gift_line boolean not null default false`.
- Marks a **gift-derived line**, rolled up directly from the gift tables by the
  reconcile pass. A gift line has `is_gift_line = true` and `breakdown_id` null
  (there is no gift breakdown). No new RLS policy — the existing `budget_line`
  household policy covers it.

### `budget_line.gift_recipient_member_id`

- `gift_recipient_member_id uuid`, nullable, with composite FK
  `foreign key (gift_recipient_member_id, household_id) references public.members (id, household_id) on delete cascade`, plus an index.
- The partition discriminator for the gift-derived lines: on a "Gifts for
  &lt;member&gt;" line it names the household member whose gifts the line funds;
  null for the external ("others") gift line, for breakdown lines, and for manual
  lines. Cascades the line away with the member. No new RLS policy — the existing
  `budget_line` household policy covers it.

## Behaviour

- **Roll-up amount.** A derived line's amount is the summed annualised items via
  `@nest/plan` `annualCents` — for a breakdown, over its `breakdown_item` rows; for
  a gift line, its recipient partition's sum of `gift_budget.budgeted_amount_cents`
  (an annual figure), partitioned by the budget's recipient's `member_id` (null for
  external recipients). The line's `frequency` is `annual`. The amount is read-only
  in every budget surface (list, form, summary), and every surface resolves it from
  one derived-amount context so Budget, Summary, and Splits never drift.
- **Lifecycle.** A breakdown's line exists iff it has ≥ 1 item; each gift
  recipient partition's line exists iff that partition has ≥ 1 gift budget. Adding
  the first item/budget in a partition creates its line; adding or editing
  items/budgets updates its amount; removing the last removes the line. A breakdown
  line's `line_group` and `name` follow the breakdown; a gift line's group is
  per-line and preserved across reconcile (a brand-new gift line seeds to Wants),
  while its name is partition-derived ("Gifts for &lt;member&gt;", or "Gifts" for the
  external line). The one exception to removal: a breakdown line or the gift external
  ("others") line whose emptied partition still carries a user-set
  `destination_account_id` keeps its line so its pay-split routing is not silently
  lost — it stays in place (rolling up to $0) until its partition has budgets again
  or is re-routed. A gift member line is exempt from this: its routing is
  auto-derived (see below) rather than user-set, so an emptied member partition
  always removes its line rather than pinning it at $0. The reconcile
  runs in the database: `SECURITY DEFINER` triggers on every roll-up source
  (`breakdown_item`, `breakdown`, `gift_budget`, `gift_recipient`, `members`,
  `accounts`) re-derive the affected household's lines the moment a source changes,
  computing the creates, updates, and removes needed to bring the breakdown and gift
  lines into step and no-opping once they already match; a `budget_line` normalizer
  canonicalises any derived row on write. The database is the sole authority for the
  derived lines — no client code maintains them. Every collection write invalidates
  its own table's whole `[table, householdId]` cache prefix; an interactive roll-up
  source (`breakdown_item`, `breakdown`, `gift_budget`, `gift_recipient`, `gift_occasion`)
  additionally invalidates the `budget_line` prefix (via the collection's `alsoInvalidate`),
  since the trigger rewrites the derived lines server-side. So a breakdown-item or gift
  edit both refetches the roll-up sources — letting the Budget and Summary tabs recompute
  the amounts live via `derivedAmountContext` — and refetches the trigger-updated
  `budget_line` rows the Pay splits tab reads directly, all with no reload. `members` and
  `accounts` drive the same trigger through their own client actions: creating or joining
  a household invalidates the new household's `budget_line` prefix once the RPC returns,
  and the on-demand Up sync invalidates it when the sync completes, so a new member's gift
  lines and account-driven gift funding refresh with no manual reload.
- **System-managed amount.** A derived line is not created via the budget form and
  is not manually deletable, and its amount is not hand-editable — it is rolled up
  from the breakdown's items or, for a gift line, the gift tables. Deleting a
  breakdown cascade-deletes its line (via the FK); a gift line is removed by the
  reconcile when its partition empties.
- **Editable inline.** A derived line's group and funding account edit inline from
  the budget list like a manual line: a breakdown line's name and group write to the
  owning `breakdown` (the reconcile pass copies them back onto the line); a gift
  line's name is partition-derived and shows read-only, and its group is per-line, so
  a gift-line edit writes the group straight onto the line — each gift line's group
  is independent, and changing one leaves the others alone. The group choices exclude
  Savings/Investments, which route via a goal rather than a funding account.
- **Funding account.** A breakdown line and the gift external ("others") line carry
  a user-set `destination_account_id`, edited from a "Funded from" picker. A gift
  member line's funding account is **not** user-configurable: it is auto-derived
  each reconcile as the **buyer's** spending account — the _other_ household member's
  `type = 'transaction'` account in `account_directory` (never the joint account,
  whose `owner_member_id` is null), since with the household's two members fixed the
  buyer of a member's gifts is always the other member. It resolves to null (the line
  shows unassigned) when Up is not synced or the buyer has no spending account. The
  reconcile always overwrites this field for a gift member line, so the editor omits
  the picker (showing a read-only note) and never writes it.
- **Routable.** A derived line is an ordinary `budget_line` in every other respect:
  it carries a `destination_account_id` and feeds the Pay splits tab's per-account
  recommendation like any line.

## UI

- **Breakdowns tab** (route `/breakdowns`, in `NAV_ITEMS`) — lists every breakdown
  with its name, group, and rolled-up fortnightly + annual total, plus a
  **New breakdown** action (a name and a group). Gift lines never appear here. Each
  row taps through to `/breakdowns/:id`.
- **Gifts tab** (route `/gifts`, in `NAV_ITEMS`) — the unified gift planner and the
  sole place gifts are managed, showing every recipient, occasion, budget, and
  purchase. It reads and writes the household-scoped `gift_*` tables directly; the
  reconcile pass derives the gift budget lines from them. A **Refresh** action beside
  **Manage** invokes `up-sync` for the caller's household and reloads both the gift
  tables and the synced transactions, so spending just recategorised as a gift in the
  Up app reaches the tab without waiting for the hourly cron; a failed sync shows an
  alert and leaves the existing data in place.
- **"From your card" inbox** (the first section of the Gifts tab) — the
  gift-category transactions `up-sync` ingested that are neither linked to a purchase
  nor set aside, newest first. The section renders only when it has rows, so a
  household with no synced gift spending sees nothing. Each row shows the
  transaction's description (or "Card purchase" where Up gives none), its posting
  date, and its amount, plus a `Pending` badge and a note while the transaction is
  still `HELD` and its amount can still change on settlement.
  - **Link to a gift** opens an inline form: a gift picker ("recipient — occasion")
    and a description seeded from Up's wording, editable into something the gift log
    reads better. The amount and date are fixed to the transaction — a linked
    purchase follows its transaction's amount — and the form says so. Saving writes a
    `gift_purchase` carrying `transaction_id`, its `purchased_on` the transaction's
    `posted_at` as a **local** calendar date rather than a slice of the UTC
    timestamp, so a late-evening purchase is not dated a day out.
  - The picker omits any gift for the signed-in member: their own gift's spend is
    hidden from them, so RLS refuses the insert and offering the budget would only
    fail on save. The same privacy holds from the other direction without the
    client doing anything: RLS withholds a transaction claimed as a gift for the
    signed-in member, so their inbox never lists it.
  - **Not a gift** sets a row aside, writing a `gift_transaction_dismissal` — Up
    files charity donations in the same category, so this is routine. The set-aside
    rows sit behind a `Set aside (n)` toggle, each with an **Undo** that deletes the
    dismissal and returns the row to the inbox. A dismissal whose transaction the
    signed-in member cannot see is dropped rather than rendered as a blank row.
  - A purchase or dismissal write invalidates the `transactions` cache alongside its
    own table, so a claimed or set-aside row leaves the inbox with no reload.
- **Gift purchase rows** — every pairing row takes a hand-entered purchase
  (description, amount, date) as well; a purchase linked from a synced transaction
  carries a neutral `From Up` badge, so card spend reads apart from a typed one.
- **`/breakdowns/:id`** — the item editor: the item list with add / edit / remove
  (name + amount + frequency, `every_n_weeks`/`every_n_months` taking an interval as
  elsewhere); rename the breakdown; choose its group; delete the breakdown.
- **Budget list** — a derived line carries a tap-through chevron to its source — a
  breakdown line to its breakdown (`/breakdowns/:id`), a gift line straight to the
  Gifts tab (`/gifts`) — and an edit
  pencil that opens an inline editor for its group and funding account (and name, for
  a breakdown line — a gift line's name shows read-only). Its amount shows read-only
  there, with a link to change the itemised total. The gift roll-up drives several
  rows — "Gifts for &lt;member&gt;" per member with gift budgets, plus "Gifts" for
  external recipients. The external line offers an editable "Funded from" picker; a
  "Gifts for &lt;member&gt;" line replaces it with a read-only note ("Funded
  automatically from the buyer's spending account"), since its account is
  auto-derived, not chosen.
- **Absent surfaces** — there is no budget-line-form Amount source picker, no gift
  option in the Breakdowns creation form, and no in-breakdown gift editor. There is
  no Health tab; medications is a generic breakdown the household creates.

## Pure logic (`@nest/plan`)

The roll-up reuses `annualCents`: a breakdown's amount is the sum of
`annualCents(item.amount_cents, item.frequency, item.interval_count)` over its
items; the gift lines' per-recipient amounts come from `giftTotalsByMember`, which
partitions the gift-budget totals by the recipient's `member_id`.

## Invariants

- **Empty-breakdown lifecycle is trigger-enforced, not constraint-enforced.** No
  declarative constraint creates, updates, or removes the lines as items come and go;
  the reconcile trigger owns that lifecycle, so a breakdown or gift partition with no
  items/budgets and no derived line is a valid resting state the trigger converges to.
- **Line-per-breakdown mapping is trigger-enforced, not constraint-enforced.** No
  constraint ties a breakdown to its line or a gift partition to its line; the trigger
  keeps a breakdown 1:1 with its line (matched by `breakdown_id`) and the gift roll-up
  1:1 with each recipient partition (matched by `is_gift_line` +
  `gift_recipient_member_id`).
- **Roll-up amount is trigger-enforced, not constraint-enforced.** A derived line's
  `amount_cents` is written by the trigger from its partition's summed items/budgets;
  no schema constraint computes or checks it.
