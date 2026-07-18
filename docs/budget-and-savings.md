# Budget & savings

The plan-only, fortnightly budget: how money in (inflows) is classified for tax,
how it is allocated across grouped budget lines, and how savings goals and
short-lived temporary items accumulate toward a target. It replaces the
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

A goal and a temporary item are the same underlying mechanic: **accumulate a
contribution toward a target**. They share one foundation with two flavors.

### Savings goal (persists)

- Fields: `name`, `target amount`, optional `target date`, `current balance`
  (entered manually for now; sourced from real balances later via ingestion).
- A Savings budget line links to a goal. Allow **many lines → one goal**; the
  goal's fortnightly contribution is the sum of its linked lines.
- Progress and ETA are projected from `current + contribution × fortnights`.

### Temporary item (self-expiring)

- Fields: `name`, `target`, `fortnightly contribution` **or** `target date` (set
  one, derive the other), `start date`.
- It is a fortnightly outflow while active.
- **Auto-expires** when funded (`contribution × fortnights ≥ target`) or once the
  end date passes, then drops out of the live fortnightly buffer.
- A manual "done" override marks it complete early.

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
- **TemporaryItem** — a self-expiring target.
  - `id`, `household_id`, `name`, `target_cents`, `contribution_cents`
    (fortnightly) or `target_date`, `start_date`, `done` (manual override).

### Derived / computed (not stored)

- Fortnightly and annual normalization of every inflow and budget line.
- Summary reconciliation (Available, Outgoings, Savings block, buffer, portions).
- Goal progress and ETA; temporary-item funded/expiry state.

## Computation

Budget, summary, and goal math lives in a **new pure package, `@budget/plan`** —
unit-tested and consumed by the PWA, mirroring `@budget/tax`. It has no I/O and no
database access. It handles:

- **Schedule normalization** — any frequency → fortnightly and annual.
- **Summary reconciliation** — Available, Outgoings, Savings block, remaining
  buffer, and per-group portions.
- **Goal projection** — progress and ETA from current balance, summed
  contribution, and target.
- **Temporary projection** — derive contribution from date (or vice versa) and
  compute funded/expiry state.

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
3. **`@budget/plan`** — pure computation package (normalization, summary,
   goal/temporary projection) + tests.
4. **Budget CRUD UI.**
5. **Summary / reconciliation UI.**
6. **Goals + Temporary UI.**

## Deferred

- **Netting non-taxable inflows against categories** — assign a non-taxable
  inflow to a specific budget category so it nets against that spend.
- **Actual-spend reconciliation and real balances** — reconcile spend against the
  budget and populate goal balances from Up ingestion.
- **Routing** — navigation stays state-based for now.
