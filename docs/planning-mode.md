# Planning mode

A client-side sandbox the household turns on to try changes to its cash-flow
numbers — pays, bills, and savings goals — and watch every downstream projection
recompute, with nothing written to the database. Leaving planning mode discards
the edits.

It generalises the localised what-ifs already in the app (the Tax tab's
salary-sacrifice and private-hospital toggles, the retirement-projection
assumptions) into one app-wide layer, using the same idea as
[`retirement.ts`](../apps/pwa/src/lib/retirement.ts): a JSON blob in
`localStorage`, read and written through plain helpers.

## What is editable

Only three tables are sandboxed:

| Table          | In planning mode                                              |
| -------------- | ------------------------------------------------------------- |
| `inflows`      | every field, plus new and deleted inflows                     |
| `budget_line`  | **manual lines only** — amount, group, frequency, routing     |
| `savings_goal` | every field, plus new and deleted goals                       |

Everything else keeps writing real data while planning mode is on:

- **Derived budget lines** — a line with `breakdown_id` set or `is_gift_line`
  true is read-only in planning mode. Its edit writes a `breakdown` or gift row
  (not a sandboxed table), and it cannot reflow without the database's
  `reconcile_derived_lines` trigger. `BudgetSection` withholds the derived-line
  edit handler while planning mode is active, so only manual lines carry an edit
  control.
- **Everything RPC-backed or outside the three tables** — tax profile, HELP
  debt, super contributions, deductions, equity, payslips, gifts, breakdowns,
  account balances, pay splits, temporary items. These forms stay live and save
  to Postgres as normal. Disabling each one is invasive and spread across many
  components; the boundary is documented here and stated on the entry control
  instead. The tax estimate still recomputes in the sandbox, because it is
  derived from the (edited) inflows by the pure `@nest/tax` functions.

## Persistence

The sandbox is stored per device, per household, under the `localStorage` key
`planning-mode:<householdId>`:

```jsonc
{
  "active": true,
  "overrides": {
    "inflows": { "updates": { "<id>": { "amount_cents": 9000000 } }, "creates": [], "deletes": [] },
    "budget_line": { "updates": {}, "creates": [{ "id": "…", "name": "New line", … }], "deletes": [] },
    "savings_goal": { "updates": {}, "creates": [], "deletes": ["<id>"] }
  }
}
```

It survives a refresh — a persistent app-shell banner
(`PlanningModeBanner`) makes it unmistakable that planning mode is on and offers
the one action that leaves it. Leaving planning mode removes the key. Every
`localStorage` access is wrapped, so a private-mode browser that throws still
works (the sandbox just will not survive a reload).

One sandbox per household — not named scenarios.

## Mechanism

Every cash-flow hook (`useInflows`, `useBudgetLines`, `useGoals`) goes through
the `useHouseholdCollection` factory
([`hooks/useCollection.ts`](../apps/pwa/src/hooks/useCollection.ts)), and every
section recomputes its derived views from that hook's `rows` through the pure
`@nest/plan` / `@nest/tax` functions. So one integration point covers the app:

1. **`lib/planningMode.ts`** — the `localStorage` store: `readPlanningMode` /
   `writePlanningMode` / `clearPlanningMode`, `applyOverrides(rows, layer)`
   (drop `deletes`, merge `updates` by id, append `creates`), and the pure
   layer mutators (`layerUpdate`, `layerCreate`, `layerDelete`,
   `layerResetRow`).
2. **`components/PlanningModeProvider.tsx`** — a context, mounted in
   `HouseholdApp`, holding the state in React and persisting every change.
   `usePlanningMode()` exposes `active`, `enter()`, `exit()`, `pendingCount`,
   and the per-table mutators (`applyUpdate` / `applyCreate` / `applyDelete` /
   `resetRow` / `resetAll`). Outside a provider it returns an inert value
   (planning off, mutators no-ops), so a component or test that renders a
   collection hook without the provider still works.
3. **`useHouseholdCollection`** — for `inflows`, `budget_line`, and
   `savings_goal` only, when planning mode is active: `rows` is `query.data`
   with the override layer applied; `create` / `update` / `remove` route into
   the provider instead of PostgREST and skip react-query invalidation (the
   context re-render refreshes consumers). react-query's unmodified `query.data`
   stays the untouched baseline. Every other table, and the whole
   `useHouseholdUpsertCollection` path, is unchanged.

## Comparison

Every key figure reads `real → proposed (±Δ)` while planning mode is on and the
sandbox has moved it; off planning mode, or where the two agree, it is just the
plain figure, so the components wire in unconditionally.

### Baseline access

`useHouseholdCollection` returns `baselineRows` alongside `rows` — the rows
exactly as PostgREST returned them, before the override layer. It equals `rows`
outside planning mode and for a non-sandboxed table. The three cash-flow hooks
surface it as `baselineInflows` / `baselineLines` / `baselineGoals`. A section
computes its derived view twice — once from the proposed rows, once from the
baseline — by calling the same pure `@nest/plan` / `@nest/tax` function with each
set, so the two never drift. `summariseHousehold` (`lib/summary.ts`) and
`computeNetWorth` (`lib/netWorth.ts`) wrap the multi-step Summary and net-worth
derivations so the tab and the `/planning` roll-up share one implementation.

### `ComparedAmount` / `ComparedDate`

[`components/ComparedAmount.tsx`](../apps/pwa/src/components/ComparedAmount.tsx).
`ComparedAmount` takes `baselineCents` + `proposedCents` and renders
`$real → $proposed (±$Δ)` with the delta in the money-sign colours (an increase
green, a decrease red, via `signMoneyColor`). `ComparedDate` is the goal-ETA
variant: `baselineIso` + `proposedIso`, rendering `real → proposed (N days
sooner|later)`; either side may be `null` (no ETA). Both read
`usePlanningMode().active` and fall back to a plain `MoneyText` / date when off
or unchanged.

### Where the deltas appear

- **Summary** (`SummaryView`) — every reconciliation row's fortnightly figure,
  so the buffer (After Saving) and each group allocation total show their move.
- **Tax estimate** (`TaxEstimateView`) — each card's take-home (fortnightly and
  annual), total tax, and — once payslips have recorded withholding — the
  tracked refund/bill balance.
- **Goals** (`GoalList`) — each goal's ETA (a dated goal's required
  contribution, an undated goal's projected completion date) and its funding
  contribution.
- **Net worth** (`NetWorthView`) — the total net-worth figure and the projected
  end-of-horizon figure below the projection chart.

## The `/planning` screen

[`routes/PlanningSection.tsx`](../apps/pwa/src/routes/PlanningSection.tsx) +
[`components/PlanningScreen.tsx`](../apps/pwa/src/components/PlanningScreen.tsx),
routed at `/planning` and added to the nav (beside Summary) only while planning
mode is active; the app-shell banner also links to it via a **Review** action.
Navigating there with planning mode off redirects to `/summary`.

It has two parts:

- **Pending changes** — every held override: the table, the row (by name),
  whether it is an edit / a new row / a removal, and for an edit each moved
  field as `was → now`. Each row has a **Reset** that calls `resetRow`.
- **Projected impact** — the roll-up: the fortnightly buffer, the year's tax and
  take-home, net worth and projected net worth, and each goal's ETA, each as
  real vs proposed vs Δ through the same `ComparedAmount` / `ComparedDate` and
  the same twice-computed views the inline deltas use.

**Discard changes** (`resetAll`, staying in planning mode) and **Exit planning
mode** (`exit`, dropping the sandbox) sit at the foot of the screen.

## Phases

1. **The sandbox core.** Provider + store + `useHouseholdCollection`
   integration + the app-shell banner + the entry control. Forms edit the
   sandbox transparently and every derived view already recomputes.
2. **Comparison (this).** Baseline access, the inline `real → proposed (±Δ)`
   deltas, and the `/planning` screen.
