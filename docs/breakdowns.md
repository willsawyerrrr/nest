# Breakdowns

A **breakdown** is a user-created, household-scoped itemised list whose items roll
up into a derived budget line. The household creates arbitrary breakdowns; a
generic breakdown owns one real budget line whose amount is the sum of its items,
while the gift breakdown owns one line per recipient partition (one per household
member with gift budgets, plus one for all external recipients), so the lines and
their detail are one source of truth and never drift. Breakdowns are the sole
source of derived budget lines: the gift planner and medications are breakdowns
defined as data, not hardcoded enum cases.

Amounts are integer minor units (cents). Every item carries an amount + frequency,
normalised to fortnightly and annual exactly as a budget line is.

## Decisions (locked)

- **Breakdowns are data, not an enum.** Any itemised budget the household wants —
  gifts, medications, a holiday's line items — is a breakdown row it creates, names,
  and assigns to a budget group. There is no fixed catalogue of sources and no
  migration per new source.
- **A generic breakdown owns one derived line; the gift breakdown owns one per
  recipient partition.** A rolled-up line is a real, routable `budget_line` row (it
  participates in the Pay splits tab's account routing like any line). A generic
  breakdown owns exactly one line whose group, name, and amount come from the
  breakdown. The gift breakdown instead splits by recipient: one derived line per
  household member who has gift budgets — named "Gifts for &lt;member&gt;" and
  discriminated by `budget_line.gift_recipient_member_id` — plus one line keeping the
  breakdown's own name for all external (non-member) recipients (the null
  discriminator). Each gift line carries its own recipient partition's total. A
  "Gifts for &lt;member&gt;" line is funded automatically from the **buyer's** — the
  other partner's — spending account, not user-configurable; the external line and
  every generic line keep a user-set funding account. A line's amount is read-only
  and system-managed in every case.
- **The line exists only when there is something to roll up.** A generic breakdown
  with no items has no budget line, and a gift recipient partition with no gift
  budgets has no line. A line is created when the first item/budget in its partition
  lands and removed when the last goes, so an empty breakdown or partition never
  shows a $0 line in the budget.
- **`kind` picks the editor, not a per-instance type.** `kind = 'generic'` uses a
  simple item editor; `kind = 'gift'` uses the recipient × occasion + purchases
  planner and keeps its bespoke `gift_*` tables. `kind` is a small enum that selects
  behaviour, not an open per-breakdown enumeration.
- **Derived lines are never created from the budget form.** The budget-line form has
  no "Amount source" picker; a derived line comes into being only through its
  breakdown.
- **Gifts is a breakdown.** The gift planner uses its own UX and its
  `gift_recipient` / `gift_occasion` / `gift_budget` / `gift_purchase` tables; it is
  reached as a `kind = 'gift'` breakdown, not a standalone tab.
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
  An unlinked recipient is an external person, fully shared.
- **Every household member is a permanent recipient.** A member's recipient is
  auto-created with the member and removed with them, and cannot be renamed or
  deleted (enforced in the database by an insert trigger, an `on delete cascade`
  FK, a one-per-member unique index, and an update guard). The Gifts screen lists
  the members first as fixed rows; adding a recipient is for external people only.
- **Medications is a generic breakdown.** There is no bespoke Health tab or
  medication schema; the household creates a generic breakdown and lists its
  medications as items.

## Data model

Two tables plus one column on `budget_line`, mirroring the gift tables'
conventions — composite `(id, household_id)` keys, RLS on household membership, a
`set_updated_at` trigger, and explicit grants.

### `breakdown`

- `id uuid primary key default gen_random_uuid()`
- `household_id uuid not null references public.households on delete cascade`
- `name text not null` — the rolled-up line's name.
- `line_group public.budget_group not null` — the budget group the rolled-up line
  belongs to. Each breakdown specifies its own group.
- `kind public.breakdown_kind not null default 'generic'` — selects the editor and
  the roll-up source (`'generic'` reads `breakdown_item`; `'gift'` reads the
  `gift_*` tables).
- `created_at` / `updated_at timestamptz not null default now()`
- `unique (id, household_id)` — the composite key children reference.

The enum `create type public.breakdown_kind as enum ('generic', 'gift')` backs
`kind`.

### `breakdown_item`

Owned by generic breakdowns; a `gift` breakdown owns no `breakdown_item` rows (its
items live in `gift_budget`).

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
  breakdown; null is an ordinary manual line.

### `budget_line.gift_recipient_member_id`

- `gift_recipient_member_id uuid`, nullable, with composite FK
  `foreign key (gift_recipient_member_id, household_id) references public.members (id, household_id) on delete cascade`, plus an index.
- The partition discriminator for the gift breakdown's derived lines: on a
  gift-breakdown line it names the household member whose gifts the line funds;
  null for the gift breakdown's external-recipients line, for generic-breakdown
  lines, and for manual lines. Cascades the line away with the member. No new RLS
  policy — the existing `budget_line` household policy covers it.

## Behaviour

- **Roll-up amount.** A derived line's amount is the summed annualised items via
  `@nest/plan` `annualCents` — for a generic breakdown, over its `breakdown_item`
  rows; for a `gift` breakdown, each line takes its recipient partition's sum of
  `gift_budget.budgeted_amount_cents` (an annual figure), partitioned by the
  budget's recipient's `member_id` (null for external recipients). The line's
  `frequency` is `annual`. The amount is read-only in every budget surface (list,
  form, summary), and every surface resolves it from one derived-amount context so
  Budget, Summary, and Splits never drift.
- **Lifecycle.** A generic breakdown's line exists iff it has ≥ 1 item; each gift
  recipient partition's line exists iff that partition has ≥ 1 gift budget. Adding
  the first item/budget in a partition creates its line; adding or editing
  items/budgets updates its amount; removing the last removes the line. A generic
  line's `line_group` and `name` follow the breakdown; a gift line's group follows
  the breakdown while its name is partition-derived ("Gifts for &lt;member&gt;", or
  the breakdown's name for the external line). The one exception to removal: a
  generic line or the gift external ("others") line whose emptied partition still
  carries a user-set `destination_account_id` keeps its line so its pay-split routing
  is not silently lost — it stays in place (rolling up to $0) until its partition has
  budgets again or is re-routed. A gift member line is exempt from this: its routing
  is auto-derived (see below) rather than user-set, so an emptied member partition
  always removes its line rather than pinning it at $0. The reconcile
  runs app-wide from a headless component mounted under the authenticated shell (not
  on any one route), so a breakdown or gift edit made anywhere rewrites the owned
  lines: it computes the creates, updates, and removes needed to bring each
  breakdown's lines into step, and is a no-op once they already match. Every
  collection write invalidates its table's whole `[table, householdId]` cache
  prefix, so a breakdown-item or gift-budget edit refreshes both the scoped query and
  the unscoped roll-up, the reconcile sees the fresh totals, and the derived amounts
  propagate live to the Budget, Pay splits, and Summary tabs with no reload.
- **System-managed amount.** A derived line is not created via the budget form and
  is not manually deletable, and its amount is not hand-editable — it is rolled up
  from the breakdown's items. Deleting the breakdown cascade-deletes its line (via
  the FK).
- **Editable inline.** A derived line's group and funding account edit inline from
  the budget list like a manual line: a generic line's name and group write to the
  owning `breakdown` (the reconcile pass copies them back onto the line); a gift
  line's name is partition-derived and shows read-only, so only its group flows to
  the breakdown (shared across all its gift lines) while its name is left untouched.
  The group choices exclude Savings/Investments, which route via a goal rather than a
  funding account.
- **Funding account.** A generic line and the gift external ("others") line carry a
  user-set `destination_account_id`, edited from a "Funded from" picker. A gift
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
  with its name, group, and rolled-up fortnightly + annual total, plus a **New
  breakdown** action (a name and a group). Each row taps through to
  `/breakdowns/:id`.
- **`/breakdowns/:id`** — the editor, chosen by `kind`:
  - `kind = 'generic'` — a simple item editor: the item list with add / edit /
    remove (name + amount + frequency, `every_n_weeks`/`every_n_months` taking an
    interval as elsewhere); rename the breakdown; choose its group; delete the
    breakdown.
  - `kind = 'gift'` — the recipient × occasion + purchases planner, reached via this
    route.
- **Budget list** — a derived line carries a tap-through chevron to its breakdown
  (`/breakdowns/:id`) and an edit pencil that opens an inline editor for its group
  and funding account (and name, for a generic line — a gift line's name shows
  read-only). Its amount shows read-only there, with a link to the breakdown page to
  change the itemised total. A gift breakdown renders as several rows — "Gifts for
  &lt;member&gt;" per member with gift budgets, plus "Gifts" for external recipients.
  The external line offers an editable "Funded from" picker; a "Gifts for
  &lt;member&gt;" line replaces it with a read-only note ("Funded automatically from
  the buyer's spending account"), since its account is auto-derived, not chosen.
- **Absent surfaces** — there is no standalone Gifts tab (gifts is reached from the
  Breakdowns list) and no budget-line-form Amount source picker. There is no Health
  tab; medications is a generic breakdown the household creates.

## Pure logic (`@nest/plan`)

The roll-up reuses `annualCents`: a generic breakdown's amount is the sum of
`annualCents(item.amount_cents, item.frequency, item.interval_count)` over its
items; a `gift` breakdown's per-recipient amounts come from `giftTotalsByMember`,
which partitions the gift-budget totals by the recipient's `member_id`. No
per-source special-casing beyond the two `kind` branches.

## Invariants

- **Empty-breakdown lifecycle is app-enforced, not DB-enforced.** The schema
  permits a breakdown or gift partition with no items/budgets and no derived line,
  and does not itself create, update, or remove the lines as items come and go — the
  app's reconcile pass owns that lifecycle.
- **Line-per-breakdown mapping is app-enforced, not DB-enforced.** No constraint
  ties a breakdown to its lines; the app keeps a generic breakdown 1:1 and the gift
  breakdown 1:1 with each recipient partition (matched by
  `(breakdown_id, gift_recipient_member_id)`).
- **Roll-up amount is app-enforced, not DB-enforced.** A derived line's
  `amount_cents` is written by the app from its partition's summed items/budgets; the
  schema does not compute or check it.
