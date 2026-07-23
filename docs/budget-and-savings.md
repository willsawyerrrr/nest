# Budget & savings

The plan-only, fortnightly budget: how money in (inflows) is classified for tax,
how it is allocated across grouped budget lines, how savings goals project
toward a target, and how short-lived temporary items run until a target date. It
replaces the
household's spreadsheet with no transaction data — projections only. Actual-spend
reconciliation arrives later with Up ingestion.

Amounts are integer minor units (cents). The fortnight is the primary period; the
household is a single shared container with money fully pooled.

## Inflows

Money in is modelled as **inflows**, split by taxability:

- **Taxable inflows** (income) — salary, wage, or other regular income. Each is
  attributed to one member and feeds the tax estimate, because AU tax is assessed
  per person. A taxable inflow requires a member tag.
- **Non-taxable inflows** — money in that is excluded from assessable income
  (a reimbursement, hobby income, a gift, or other) and adds directly to
  available cash. Non-taxable inflows do not require a member tag. The chosen
  `type` is a reporting label only; taxability, not type, decides whether an
  inflow is taxed.

The tax computation sums only taxable inflows into assessable income; non-taxable
inflows never reach the tax engine.

A capped-but-always-spent work reimbursement is modelled as a fixed regular
non-taxable inflow at the cap amount.

## Schedules & normalization

Every inflow and budget line carries an amount and a frequency. All figures
normalize to a **fortnight** (primary) and to an **annual** total.

| Frequency       | Periods / year |
| --------------- | -------------- |
| weekly          | 52             |
| fortnightly     | 26             |
| monthly         | 12             |
| quarterly       | 4              |
| biannual        | 2              |
| annual          | 1              |
| every N weeks    | 52 ÷ N         |
| every N months   | 12 ÷ N         |

Fixed frequencies: annual amount = `amount × periods_per_year`. The `every N
weeks` cadence — an amount received once every N weeks, where N is a
user-supplied positive integer — annualises to `round(amount × 52 ÷ N)`, and the
`every N months` cadence — once every N months — to `round(amount × 12 ÷ N)`.
Fortnightly amount = `round(annual ÷ 26)` in every case.

## Budget (plan-only, fortnightly)

A budget line allocates a recurring amount to a named purpose within one of six
fixed groups. There is one living budget per household — no per-period
versioning. No actual-spend reconciliation yet. The UI labels a budget line a
**budget item** (Add item, Delete budget item, and so on); "line" persists only
in the schema (the `budget_line` table and its `line_group` column).

| Group             | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| **Needs**         | Regular essentials                                 |
| **Wants**         | Regular quality-of-life                            |
| **Discretionary** | Budgets for non-regular discretionary purchases    |
| **Temporary**     | Short-term / one-off items that expire (see below) |
| **Savings**       | Money set aside toward a goal                       |
| **Investments**   | Money set aside to invest                           |

A budget line = `household_id`, `line_group`, `name`, `amount` + `frequency`
(normalized to fortnightly and annual). Like inflows, a line on the `every N
weeks` or `every N months` cadence carries its interval `N` in `interval_count`,
the unit read from the frequency.

### Derived budget lines

A line's amount is normally typed. It can instead be **derived** — rolled up from a
user-created **breakdown** (an itemised list) that owns the line via
`budget_line.breakdown_id`, so the line and its detail never drift. The summary
substitutes the breakdown's rolled-up amount for the typed `amount_cents`. Gifts
are the first breakdown (`kind = 'gift'`); medications and any other itemised
budget are `generic` breakdowns the household creates. See
[`breakdowns.md`](breakdowns.md) and
[`data-model.md`](data-model.md#breakdowns).

## Targets — goals & temporary items

A goal and a temporary item are both budget lines with a completion condition,
but they differ in how completion is defined: a **goal is target-driven** (an
app-projected progress toward a target amount), while a **temporary item is
date-driven** (an active outflow until a target date, with no app-side funding
math).

### Savings goal (persists)

- Fields: `name`, `target amount`, optional `target date`, `current balance`,
  and an optional link to an Up saver (`linked_account_id`). When linked, the
  current balance comes from the synced saver's `balance_cents`; otherwise it is
  the manually entered `current_balance_cents`.
- A Savings budget line links to a goal. Allow **many lines → one goal**; the
  goal's fortnightly contribution is the sum of its linked lines. Only the
  contribution is entered, never derived.
- Progress and ETA are projected from `current + contribution × fortnights`.
- Each goal shows its progress visually: a bar and a percentage of the current
  balance against the target, coloured by status (on track, behind, reached). A
  per-goal expand reveals a compact area chart projecting the balance climbing
  fortnight by fortnight to a target reference line, using the goal's summed
  fortnightly contribution (`goalProjectionSeries` in `@nest/plan`). An unfunded
  or already-met goal — one with no climb to plot — shows a short note in place
  of the chart.

### Temporary item (date-driven)

- The app does **not** calculate contributions, funding, or expiry from a target
  amount. An **external source of truth** (e.g. an Up Saver or Maybuy) owns the
  actual balance saved toward the item.
- Fields: `name`, `contribution` (the fortnightly amount put in — a budget
  outflow in the Temporary group), `target date`.
- **Expiry is date-driven:** the item is an active fortnightly outflow until its
  target date, after which it drops out of the live fortnightly buffer. There is
  no auto-expire-when-funded calculation and no app-owned target-amount funding
  math.

## Summary / reconciliation

The Summary mirrors the household's existing spreadsheet: it reconciles available
money against outgoings and money set aside, leaving a buffer.

- **Available** = after-tax income (from the tax estimate over taxable inflows) +
  non-taxable inflows.
- **Outgoings** = Needs + Wants + Discretionary + Temporary.
- **Savings block** = Savings + Investments.
- **Remaining buffer** = Available − Outgoings − Savings block.

The dashboard shows each group's fortnightly, annual, and **portion** (share of
Available), plus the running "After Outgoing" and "After Saving" figures.

The allocation donut leading the dashboard can be viewed on a **take-home
(post-tax)** or **gross (pre-tax)** basis via a toggle (the choice persists per
device). Take-home is the default: the budget-group and buffer slices as shares
of Available — what the household does with each pay once it lands. Gross keeps
those same slices but prepends a **Tax** slice (income tax and levies, including
the 15% super contributions tax) and a **Salary sacrifice** slice (the
household's total pre-tax amounts sacrificed from pay — currently just the net
concessional super landing in the fund, but extensible to other sacrifices such
as a novated lease), so the donut sums to gross income — where every gross dollar
goes before the household is paid. The slices keep the
same fortnightly values in both modes; only the percentage denominator changes
(Available in take-home, the gross basis in gross), and the ledger and donut
share it so their percentages agree.

The basis also drives the stat tiles and the reconciliation ledger. Take-home
shows the three Income / Outgoing / Remaining tiles and a ledger that runs from
Available down through the groups to the buffer. Gross adds a Gross / Tax /
Salary sacrifice row of tiles above those three, and leads the ledger with a
**Gross** subtotal and the **Tax** and **Salary sacrifice** deductions before Available
(itself then read as after-tax, after-super cash); everything from Available
downward is identical in both modes.

| Line          | Composition                          |
| ------------- | ------------------------------------ |
| Available     | after-tax income + non-taxable in    |
| − Outgoings   | Needs + Wants + Discretionary + Temp |
| = After Outgoing | Available − Outgoings             |
| − Savings block | Savings + Investments             |
| = After Saving / Remaining buffer | running remainder |

## Data model sketch

Relational, cents, `household_id` on every row for RLS. Composite foreign keys on
`(id, household_id)` prevent cross-household references, matching the ledger and
income tables.

- **Inflow** — money in.
  - `id`, `household_id`, `name`, `taxable` (bool), `type`, `schedule`,
    `interval_count` (int ≥ 1, non-null iff `schedule` is
    `every_n_weeks`/`every_n_months`, else null), `amount_cents` (or wage
    `hourly_rate_cents` + `hours_per_period`),
    `member_id` (required when `taxable`, else null).
  - Taxable inflows feed the tax estimate; non-taxable add to available cash.
- **BudgetLine** — a planned allocation.
  - `id`, `household_id`, `line_group` (`budget_group` enum: needs / wants /
    discretionary / savings / investments), `name`, `amount_cents`, `frequency`,
    `interval_count` (int ≥ 1, non-null iff `frequency` is
    `every_n_weeks`/`every_n_months`, else null), `goal_id` (nullable; set on
    Savings/Investments lines that fund a goal),
    `breakdown_id` (nullable; a derived line owned by a breakdown — see above),
    `destination_account_id` (nullable; the Up account funding the line, for the
    Pay splits tab).
  - Temporary is a Summary group derived from the `temporary_item` table, not a
    `budget_group` value: a budget line is never authored as temporary.
- **SavingsGoal** — a persistent target.
  - `id`, `household_id`, `name`, `target_cents`, `target_date` (nullable),
    `current_cents` (manual fallback), `linked_account_id` (nullable → a synced
    Up saver; supplies the current balance when set).
  - Many budget lines link to one goal.
- **TemporaryItem** — a date-driven budget line.
  - `id`, `household_id`, `name`, `contribution_cents` (fortnightly),
    `target_date`.

### Derived / computed (not stored)

- Fortnightly and annual normalization of every inflow and budget line.
- Summary reconciliation (Available, Outgoings, Savings block, buffer, portions).
- Goal progress and ETA; temporary-item active/expired state from its target
  date.

## Computation

Budget, summary, and goal math lives in a **new pure package, `@nest/plan`** —
unit-tested and consumed by the PWA, mirroring `@nest/tax`. It has no I/O and no
database access. It handles:

- **Schedule normalization** — any frequency → fortnightly and annual.
- **Summary reconciliation** — Available, Outgoings, Savings block, remaining
  buffer, and per-group portions.
- **Goal projection** — progress and ETA from current balance, summed
  contribution, and target, plus a sampled balance-over-fortnights series
  (`goalProjectionSeries`) for the projection chart.
- **Temporary expiry** — determine whether a temporary item is still an active
  fortnightly outflow from its target date.

## UI (Mantine, mobile-first)

Tabs are path-routed via `react-router-dom`, so each is deep-linkable and
reload-safe; keyboard shortcuts jump between them.

- **Budget screen** — grouped-line CRUD with a universal "Add item" button,
  search, and sort (Default / Name / Amount + direction, persisted to
  localStorage).
- **Summary screen** — the reconciliation dashboard, led by an allocation donut.
- **Goals screen** — targets, dates, current balance, a progress bar + ETA, and
  a per-goal expandable projection chart; link Savings lines to a goal.

## Build slices

1. **Inflows schema** — taxable flag; taxable kinds require a member tag,
   non-taxable do not. Extend the schedule enum with `quarterly` + `biannual`.
   Tax computation sums only taxable inflows. Migration, RLS, tests, regenerated
   types.
2. **Budget + goals + temporary schema** — budget lines with groups; savings
   goals; temporary items. RLS, tests, types.
3. **`@nest/plan`** — pure computation package (normalization, summary, goal
   projection, temporary expiry) + tests.
4. **Budget CRUD UI.**
5. **Summary / reconciliation UI.**
6. **Goals + Temporary UI.**

## Deferred

- **Netting non-taxable inflows against categories** — assign a non-taxable
  inflow to a specific budget category so it nets against that spend.
- **Actual-spend reconciliation** — reconcile spend against the budget from Up
  transaction ingestion (savings-goal balances already come from linked savers).
- **Linking temporary items to Up Saver accounts** — the Up API exposes account
  types `SAVER`, `TRANSACTIONAL`, and `HOME_LOAN`, including balances and
  transactions. Savings goals already link to a synced saver for their balance; a
  Temporary item linking to an Up Saver to reconcile real progress is still to
  come. Maybuy is not exposed by the Up API
  (no documented resource or account type); Maybuy transactions can leak into the
  transactions feed (`up-banking/api#148`) but there is no clean Maybuy
  target/progress resource, so Maybuy-backed temporary items are tracked manually
  (or via the underlying Saver, where one applies).
