# Breakdowns

A **breakdown** is a user-created, household-scoped itemised list whose items roll
up into a single budget line. The household creates arbitrary breakdowns; each one
owns a real budget line whose amount is the sum of the breakdown's items, so the
line and its detail are one source of truth and never drift. Breakdowns replace the
fixed set of derived-budget-line sources with data: the gift planner and
medications are breakdowns, not hardcoded enum cases.

Amounts are integer minor units (cents). Every item carries an amount + frequency,
normalised to fortnightly and annual exactly as a budget line is.

## Decisions (locked)

- **Breakdowns are data, not an enum.** Any itemised budget the household wants —
  gifts, medications, a holiday's line items — is a breakdown row it creates, names,
  and assigns to a budget group. There is no fixed catalogue of sources and no
  migration per new source.
- **A breakdown owns exactly one budget line.** The rolled-up line is a real,
  routable `budget_line` row (it participates in the Splits tab's account routing
  like any line). Its group, name, and amount come from the breakdown; the amount is
  read-only and system-managed.
- **The line exists only when there is something to roll up.** A breakdown with no
  items (for a `gift` breakdown: no gift budgets) has no budget line. The line is
  created when the first item lands and removed when the last item goes, so an empty
  breakdown never shows a $0 line in the budget.
- **`kind` picks the editor, not a per-instance type.** `kind = 'generic'` uses a
  simple item editor; `kind = 'gift'` uses the recipient × occasion + purchases
  planner and keeps its bespoke `gift_*` tables. `kind` is a small enum that selects
  behaviour, not an open per-breakdown enumeration.
- **Derived lines are never created from the budget form.** The budget-line form's
  "Amount source" picker is removed; a derived line comes into being only through its
  breakdown.
- **Gifts is a breakdown.** The gift planner keeps its exact UX and its
  `gift_recipient` / `gift_occasion` / `gift_budget` / `gift_purchase` tables; it is
  reached as a `kind = 'gift'` breakdown rather than a standalone tab.
- **Medications is a generic breakdown.** There is no bespoke Health tab or
  medication schema; the household creates a generic breakdown and lists its
  medications as items.

## Data model

Two new tables plus one column on `budget_line`, mirroring the gift tables'
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

A new enum `create type public.breakdown_kind as enum ('generic', 'gift')` backs
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
- `interval_weeks int` — with the same CHECK as `budget_line`: set (≥ 1) only when
  `frequency = 'every_n_weeks'`, null otherwise.
- `created_at` / `updated_at timestamptz not null default now()`

### `budget_line.breakdown_id`

- `breakdown_id uuid`, with composite FK
  `foreign key (breakdown_id, household_id) references public.breakdown (id, household_id) on delete cascade`.
- A budget line with a non-null `breakdown_id` is a **derived line** owned by that
  breakdown; null is an ordinary manual line.
- This column **replaces** the `budget_derived_source` enum and the
  `budget_line.derived_source` column, both dropped at the end of the rollout (see
  Rollout).

## Behaviour

- **Roll-up amount.** A derived line's amount is the summed annualised items via
  `@nest/plan` `annualCents` — for a generic breakdown, over its `breakdown_item`
  rows; for a `gift` breakdown, over `gift_budget.budgeted_amount_cents` (an annual
  figure, as today). The line's `frequency` is `annual`. The amount is read-only in
  every budget surface (list, form, summary).
- **Lifecycle.** The derived line exists iff the breakdown has ≥ 1 item (for a
  `gift` breakdown: ≥ 1 gift budget). Adding the first item creates the line; adding
  or editing items updates its amount; removing the last item removes the line. The
  line's `line_group` follows the breakdown's group and its `name` follows the
  breakdown's name.
- **System-managed.** A derived line is not created via the budget form, is not
  manually deletable, and its amount is not hand-editable. Deleting the breakdown
  cascade-deletes its line (via the FK).
- **Routable.** A derived line is an ordinary `budget_line` in every other respect:
  it carries a `destination_account_id` and feeds the Splits tab's per-account
  recommendation like any line.

## UI

- **Breakdowns tab** (route `/breakdowns`, between Splits and Goals in `NAV_ITEMS`) —
  lists every breakdown with its name, group, and rolled-up fortnightly total, plus a
  **New breakdown** action. Each row taps through to `/breakdowns/:id`.
- **`/breakdowns/:id`** — the editor, chosen by `kind`:
  - `kind = 'generic'` — a simple item editor: the item list with add / edit /
    remove (name + amount + frequency, `every_n_weeks` taking an interval as
    elsewhere); rename the breakdown; choose its group; delete the breakdown.
  - `kind = 'gift'` — the existing recipient × occasion + purchases planner,
    unchanged, reached via this route.
- **Budget list** — a derived line renders as a tap-through link to its breakdown
  (`/breakdowns/:id`), replacing the fixed "from Gifts" badge. Its amount shows
  read-only.
- **Removed surfaces** — the standalone **Gifts** tab (gifts is reached from the
  Breakdowns list) and the budget-line form's **Amount source** picker. There is no
  Health tab; medications is a generic breakdown the household creates.

## Pure logic (`@nest/plan`)

The roll-up reuses the existing `annualCents`: a generic breakdown's amount is the
sum of `annualCents(item.amount_cents, item.frequency, item.interval_weeks)` over
its items; a `gift` breakdown's amount is the existing gift-budget total. No
per-source special-casing beyond the two `kind` branches.

## Rollout — additive, staged

Three PRs, each keeping `main` releasable and CI green. The schema lands alongside
the existing `derived_source` before any code switches over, and the old enum and
column are dropped only once nothing reads them.

### Stage 1 — schema (additive)

- Add `breakdown` + `breakdown_item` + `budget_line.breakdown_id` **alongside** the
  existing `budget_derived_source` enum and `budget_line.derived_source` column
  (neither dropped yet).
- Backfill: for each household with gift data, create one `kind = 'gift'` breakdown
  named "Gifts" whose `line_group` is the existing gift-derived line's group, and set
  that line's `breakdown_id` to the new breakdown.
- RLS isolation tests for `breakdown` and `breakdown_item`; regenerate
  `database.types`.
- App code is unchanged and still compiles — it continues to read `derived_source`.
  Green.

### Stage 2 — app switch

- Generic roll-up keyed by `breakdown_id`; `useBreakdowns` / `useBreakdownItems`
  hooks.
- The **Breakdowns** tab and `/breakdowns/:id` (the generic editor plus the gift
  editor, dispatched by `kind`).
- Derived-line lifecycle: create-on-first-item, hide/remove-when-empty; the amount,
  group, and name tracked from the breakdown.
- Tap-through links from the budget list to the breakdown.
- Remove the **Gifts** tab and the budget-form **Amount source** picker.
- The gift breakdown drives its budget line from its existing `gift_*` tables.
- Green.

### Stage 3 — cleanup

- Once nothing reads them, drop the `budget_derived_source` enum and
  `budget_line.derived_source` column.
- Remove the dead gift-specific derived-line code (the `derived_source = 'gift'`
  special-casing, `applyGiftDerivedAmounts`).
- Green.

## Notes

- A bespoke medication feature (PR #154) was explored and closed as superseded by
  this design — medications is a generic breakdown, needing no dedicated schema or
  tab. Its branch `feat/health-tracking` is retained for reference.
- Gift data is preserved across the pivot: the gift tracker's tables and UX are
  unchanged, and Stage 1 migrates the existing gift-derived line onto a `gift`
  breakdown.

## Status

Designed, not yet built. The gift tracker ships today on the `budget_derived_source`
enum + `budget_line.derived_source` column; this design genericises that mechanism to
user-created breakdowns keyed by `budget_line.breakdown_id`, with gifts becoming the
first (`kind = 'gift'`) breakdown and medications the first generic one.

## Open questions

- **Empty-breakdown lifecycle is app-enforced, not DB-enforced.** Stage 1's schema
  permits a breakdown with no items and no derived line, and does not itself create,
  update, or remove the line as items come and go — that lifecycle lands in Stage 2's
  app code. Whether any of it should be pushed into DB triggers is left open.
- **One-line-per-breakdown is a convention, not a constraint.** No unique constraint
  ties a breakdown to a single `budget_line`; the app is trusted to keep it 1:1.
- **Roll-up amount is not enforced in the DB.** A derived line's `amount_cents` is
  written by the app from the summed items; the schema does not compute or check it.
