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
  (e.g. a work reimbursement) and adds directly to available cash. Non-taxable
  inflows do not require a member tag. This is a general concept; further
  non-taxable kinds are expected.

The tax computation sums only taxable inflows into assessable income; non-taxable
inflows never reach the tax engine.

A capped-but-always-spent work reimbursement is modelled as a fixed regular
non-taxable inflow at the cap amount.

## Schedules & normalization

Every inflow and budget line carries an amount and a frequency. All figures
normalize to a **fortnight** (primary) and to an **annual** total.

| Frequency   | Periods / year |
| ----------- | -------------- |
| weekly      | 52             |
| fortnightly | 26             |
| monthly     | 12             |
| quarterly   | 4              |
| biannual    | 2              |
| annual      | 1              |

Annual amount = `amount × periods_per_year`. Fortnightly amount = `annual ÷ 26`.
The schedule enum gains `quarterly` and `biannual`.

## Budget (plan-only, fortnightly)

A budget line allocates a recurring amount to a named purpose within one of six
fixed groups. There is one living budget per household — no per-period
versioning. No actual-spend reconciliation yet.

| Group             | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| **Needs**         | Regular essentials                                 |
| **Wants**         | Regular quality-of-life                            |
| **Discretionary** | Budgets for non-regular discretionary purchases    |
| **Temporary**     | Short-term / one-off items that expire (see below) |
| **Savings**       | Money set aside toward a goal                       |
| **Investments**   | Money set aside to invest                           |

A budget line = `household_id`, `group`, `name`, `amount` + `frequency`
(normalized to fortnightly and annual).

## Targets — goals & temporary items

A goal and a temporary item are both budget lines with a completion condition,
but they differ in how completion is defined: a **goal is target-driven** (an
app-projected progress toward a target amount), while a **temporary item is
date-driven** (an active outflow until a target date, with no app-side funding
math).

### Savings goal (persists)

- Fields: `name`, `target amount`, optional `target date`, `current balance`
  (entered manually for now; sourced from real balances later via ingestion).
- A Savings budget line links to a goal. Allow **many lines → one goal**; the
  goal's fortnightly contribution is the sum of its linked lines. Only the
  contribution is entered, never derived.
- Progress and ETA are projected from `current + contribution × fortnights`.

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
    `amount_cents` (or wage `hourly_rate_cents` + `hours_per_period`),
    `member_id` (required when `taxable`, else null).
  - Taxable inflows feed the tax estimate; non-taxable add to available cash.
- **BudgetLine** — a planned allocation.
  - `id`, `household_id`, `group` (enum: needs / wants / discretionary /
    temporary / savings / investments), `name`, `amount_cents`, `schedule`,
    `goal_id` (nullable; set on Savings lines that fund a goal).
- **SavingsGoal** — a persistent target.
  - `id`, `household_id`, `name`, `target_cents`, `target_date` (nullable),
    `current_cents` (manual for now).
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

Budget, summary, and goal math lives in a **new pure package, `@budget/plan`** —
unit-tested and consumed by the PWA, mirroring `@budget/tax`. It has no I/O and no
database access. It handles:

- **Schedule normalization** — any frequency → fortnightly and annual.
- **Summary reconciliation** — Available, Outgoings, Savings block, remaining
  buffer, and per-group portions.
- **Goal projection** — progress and ETA from current balance, summed
  contribution, and target.
- **Temporary expiry** — determine whether a temporary item is still an active
  fortnightly outflow from its target date.

## UI (Mantine, mobile-first)

Navigation stays state-based (no router) for now.

- **Budget screen** — grouped-line CRUD.
- **Summary screen** — the reconciliation dashboard.
- **Goals screen** — targets, dates, current balance, progress + ETA; link
  Savings lines to a goal.

## Build slices

1. **Inflows schema** — taxable flag; taxable kinds require a member tag,
   non-taxable do not. Extend the schedule enum with `quarterly` + `biannual`.
   Tax computation sums only taxable inflows. Migration, RLS, tests, regenerated
   types.
2. **Budget + goals + temporary schema** — budget lines with groups; savings
   goals; temporary items. RLS, tests, types.
3. **`@budget/plan`** — pure computation package (normalization, summary, goal
   projection, temporary expiry) + tests.
4. **Budget CRUD UI.**
5. **Summary / reconciliation UI.**
6. **Goals + Temporary UI.**

## Deferred

- **Netting non-taxable inflows against categories** — assign a non-taxable
  inflow to a specific budget category so it nets against that spend.
- **Actual-spend reconciliation and real balances** — reconcile spend against the
  budget and populate goal balances from Up ingestion.
- **Linking targets to Up Saver accounts** — the Up API exposes account types
  `SAVER`, `TRANSACTIONAL`, and `HOME_LOAN`, including balances and transactions.
  In the ingestion phase, a Temporary or Savings item can link to an Up Saver to
  reconcile real progress against its target. Maybuy is not exposed by the Up API
  (no documented resource or account type); Maybuy transactions can leak into the
  transactions feed (`up-banking/api#148`) but there is no clean Maybuy
  target/progress resource, so Maybuy-backed temporary items are tracked manually
  (or via the underlying Saver, where one applies).
- **Routing** — navigation stays state-based for now.
