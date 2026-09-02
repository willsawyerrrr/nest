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

## Phases

1. **The sandbox core (this).** Provider + store + `useHouseholdCollection`
   integration + the app-shell banner + the entry control. Forms edit the
   sandbox transparently and every derived view already recomputes.
2. **Comparison.** A baseline-access helper, inline "was → now (±Δ)" on the
   Summary buffer, the tax totals, goal ETAs, and the net-worth projection, and
   a `/planning` screen rolling up every override.
