# Native screens

How a screen in `apps/ios` is built. Each native screen is one route that
returns `.native` from `Route.content` (see [`ios.md`](ios.md#navigation-shell));
every route not yet native keeps the `WKWebView` fallback.

## The pattern

A screen is four parts under `Nest/Screens/<Screen>/`, on shared plumbing in
`Nest/Screens/`:

1. **Rows** (`<Screen>Data.swift`) — a `Sendable` struct holding every row the
   screen reads, and `sources(…)`, a list of `TableSource`s naming each table
   (`NestRow` models in `Data/Models.swift`), its filters, and where its rows
   land. Scope year-bound tables (`tax_profile`, `super_contribution`,
   `deduction`) with `financial_year`, as the PWA hooks do.
2. **View model** (`<Screen>ViewModel.swift`) — a `@MainActor @Observable` class
   with `state: ScreenState<Content>`. `load()` merges the sources with
   `RowsCombiner.stream`, reduces each snapshot to the screen's content (through
   the `Engine` where the PWA uses a shared engine), and publishes it. Data,
   engine and clock are initialiser parameters, so tests inject a stubbed
   `NestData` and a fake engine.
3. **Presentation** (`<Screen>Presentation.swift`) — pure functions turning the
   engine's figures into labelled rows, chart segments and percentages, mirroring
   the PWA component, so both surfaces divide and label identically.
4. **Screen** (`<Screen>Screen.swift`) — SwiftUI built from design-system
   primitives, rendered through `ScreenStateView`.

Shared plumbing:

- `ScreenState` — `loading`, `loaded(value, isRefreshing, refreshError)`,
  `failed(NestError)`. `ScreenStateView` shows a spinner, `ErrorView` with the
  error's fixed `userMessage` and a retry, or the content under a slim banner
  while refreshing or when the refresh failed (the cached content stays).
- `RowsCombiner` — merges per-table `NestData.rows` streams. It emits nothing
  until every table has a snapshot (cached or fresh), then once per snapshot,
  with `isCached` until every fresh fetch has landed. The first failing table
  ends the stream with its `NestError`.
- `ScreenEngine` — the app's one lazily created `Engine`.

### Adding a screen

1. Add any missing `NestRow` models and extend `NestRowSchemaTests`.
2. Write the rows, view model, presentation and screen as above.
3. Return the screen from `Route.content` for its route.
4. Add a parity fixture (below), a view-model test (loaded, failed, failed
   refresh keeping the cache) and presentation tests.
5. Update these docs and `CLAUDE.md`.

## Parity

A native screen shows the figures the PWA shows for the same household. The
engines are the same code (`@nest/js-core`), so parity reduces to feeding them
the same rows. Rows are read as stored: the database keeps breakdown- and
gift-derived budget lines' annual amounts canonical (the edge functions read them
the same way), so the screen does not re-derive them.

`apps/pwa/src/lib/summaryParity.test.ts` builds a household in full PostgREST row
shape, computes the Summary with the PWA's own `summariseHousehold` (derived-line
roll-up included), and snapshots rows and figures into
`apps/ios/NestTests/Fixtures/summary-parity.json`. The test fails when the
fixture drifts; `pnpm --filter @nest/pwa exec vitest run -u
src/lib/summaryParity.test.ts` rewrites it. `SummaryParityTests` decodes the same
rows into the Swift models, assembles the engine input exactly as the screen does
(`SummaryRows.input`), runs the bundled engine and asserts identical JSON.

`apps/pwa/src/lib/budgetParity.test.ts` does the same for the Budget and
Allowance screens: it computes `budgetOverview` over the PWA's mapped rows
(`toPlanBudgetLine`, `toPlanAllowance`, the shapes `BudgetLineList` uses), also
asserts each group equals the Summary's, and snapshots
`apps/ios/NestTests/Fixtures/budget-parity.json`. `BudgetParityTests` runs
`BudgetRows.input` through the bundled engine and asserts identical JSON.

## Summary

`Route.summary` is native (`SummaryScreen`): the allocation donut (Swift Charts
`SectorMark`) with a take-home/gross toggle (persisted in `UserDefaults`), stat
tiles and legend; allowance progress per member; the reconciliation ledger; and
the one-off money note. The figures come from the engine's `summariseHousehold`.
While planning mode is on, the figures are computed from the sandboxed rows and
the ledger reads `was → now (±change)` against the real rows' figures (see
[Planning mode](#planning-mode)).

### Cash-flow Sankey: web-only for now

The Sankey stays web-only until the end of the migration. Swift Charts has no
Sankey mark, so a native one means porting `sankeyLayout.ts` (node ordering,
link routing, the drill-down and sort options) onto `Canvas`, plus an
accessibility description. That is a self-contained chart with no effect on any
figure, and the web version already reads the same engine output. The Summary
shows a card that opens the web Summary page in a sheet. When the chart goes
native it replaces that card.

## Breakdowns

`Route.breakdowns` is native (`BreakdownsScreen`): the household's breakdowns, each
with its group and rolled-up fortnightly and annual totals, pushing a detail screen
with the breakdown's items (amount, cadence, fortnightly figure) and its totals.
The list and the detail share one `BreakdownsViewModel` (`breakdown` and
`breakdown_item`, each ordered by name as the PWA reads them), so opening a detail
loads nothing more and shows the same snapshot, cached then fresh. Both are
read-only for now; creating, editing and deleting still happen in the web app.

Totals come from the engine's `summariseBreakdowns` (in `packages/js-core`), which
annualises every item with `@nest/plan`'s `annualCents`, sums per breakdown, and
draws the fortnightly figure with `fortnightlyCents`, the PWA's own roll-up.
`BreakdownsPresentation` only looks the figures up and labels them (group and
cadence labels mirror `groupLabel` and `formatFrequency`). Parity is held by
`apps/pwa/src/lib/breakdownsParity.test.ts`, which computes the totals with the
PWA's `derivedAmountContext` and `breakdownTotalsByBreakdownId` and snapshots rows
and figures into `apps/ios/NestTests/Fixtures/breakdowns-parity.json`;
`BreakdownsParityTests` runs the same rows through `BreakdownsRows.input` and the
bundled engine and asserts identical figures.

A detail is pushed with `NavigationLink(value:)`, so both shells host the route in a
`NavigationStack` (the sidebar shell's detail column is wrapped in one, as each tab
already is).

## Budget and Allowance

`Route.budget` and `Route.allowance` are native (`BudgetScreen`,
`AllowanceScreen`), sharing one `BudgetViewModel` and `BudgetPresentation`.
Budget lists the five groups with the engine's fortnightly subtotals (a line
drawn from an allowance counts inside the allowance, which joins Discretionary
in full, so the subtotals equal the Summary's), each line's amount, cadence and
fortnightly figure, where it routes (allowance, goal or account), every
member's allowance, and temporary items. The signed-in member (the `members` row
whose `user_id` is the session user) alone sees what is drawn from their
allowance; their allowance links to Allowance, which lists the items drawn from
it. Other members' drawn items never reach the device (row-level security), so
their allowances show only the amount and cadence.

The overdraw guard is fixed copy on Allowance
(`BudgetPresentation.overdrawGuard`): the database refuses an item that draws
more than is left, and an allowance lowered below what is drawn.

Editing (adding, changing and deleting items, allowances and temporary items)
stays in the web app for now: each screen ends in a card opening the web page in
a sheet (`WebHandoffCard`). `Route.allowance` is outside the nav, so it is
reached by `NavigationLink(value:)` from Budget; the sidebar's detail pane is a
`NavigationStack` for the push.

## Planning mode

Planning mode is native: `Route.planning` (`PlanningScreen`) and
`Route.planningMode` (`PlanningModeScreen`, the on/off switch in Settings).
`PlanningStore` (`Screens/Planning/`) holds the signed-in household's sandbox on
the device, in `UserDefaults` under `planning-mode:<household id>`, in the same
shape the web app keeps in `localStorage`: per table (`inflows`, `budget_line`,
`savings_goal`) a `PlanningLayer` of field patches by row id, created rows and
deleted ids. It is a separate sandbox from the web app's, which lives in the web
view's own storage, so a change held in one does not appear in the other.

`PlanningLayer.apply(to:)` lays a layer over a table's rows: hidden rows dropped,
patches merged by column name, created rows appended. `SummaryRows.sandboxed(by:)`
and `BudgetRows.sandboxed(by:)` apply all three layers. Screens read
`PlanningStore.revision` as their `.task(id:)`, so they reload (cached rows, then
fresh) whenever the sandbox moves.

- **Summary** computes the engine's `summariseHousehold` twice while the sandbox
  is on, once from the sandboxed rows and once from the real ones; `LedgerCard`
  shows `ComparedAmount` per row. **Budget** and **Allowance** read the sandboxed
  lines and goals. Breakdowns are not sandboxed, as in the web app.
- **Planning** shows the projected impact (buffer, available, outgoings, saving:
  real vs proposed vs change), the pending changes (an Edited / New / Removed pill,
  `was → now`, and a Reset per row), a what-if list (an inflow's stated amount, a
  manual budget line's amount, a goal's target; a line derived from a breakdown or
  gifts is read-only), and Save, Discard and Exit. `PlanningBanner` tops Summary
  and Budget while the sandbox is on and links to Planning.
- **Save** calls `commit_planning_changes` with the same nine arguments as the web
  app (`CommitPlanningParams`), invalidating the three tables' cached rows. A
  failed save keeps every pending change and shows the error's fixed message.
- Creating a new row in the sandbox is not offered natively yet; the layer already
  holds, applies, lists and saves a created row (as one made in the web app's
  sandbox shape would be).

`apps/pwa/src/lib/planningParity.test.ts` applies a sandbox (an edited and a hidden
inflow, edited, hidden and added budget lines, an edited goal) with the PWA's own
`applyOverrides`, computes `summariseHousehold` for the real and the sandboxed rows,
and snapshots rows, sandbox and both figures into
`apps/ios/NestTests/Fixtures/planning-parity.json`. `PlanningParityTests` applies
the same sandbox with `PlanningLayer.apply(to:)`, runs the bundled engine, and
asserts both Summaries are identical.

## Wishlist

`Route.wishlist` is native (`WishlistScreen`), laid out as the PWA's: the page title
and intro, a sort control (title or amount, ascending or descending, persisted in
`UserDefaults` under `wishlist-sort`), each item as a dense row on iPad and Mac and a
bordered card on iPhone (name, owner pill, note, amount, a promote menu, edit and
delete), the inline add and edit form, and a confirm alert before a delete. It reads
`wishlist_item` and `members`, each ordered by name, through `WishlistViewModel`.

Writes go through `NestData` as the PWA's hook does: an insert carries the household
(from the members rows), an update sends `name`, `amount_cents`, `member_id` and
`note` (the last two as `null` when cleared), and a delete filters by id. The form
requires a name and a positive amount and trims the name and note, as `WishlistForm`.

Promote to a savings goal or a budget line opens the web Goals or Budget page in a
sheet with `?promoteName=…&promoteAmountCents=…`; the PWA's `takeGoalDraft` and
`takeBudgetDraft` read those parameters when no draft was stashed, so the add form
opens prefilled. They move to native when Goals and Budget editing do.

There is no engine figure: parity is the order, owner and amount of each row.
`apps/pwa/src/lib/wishlistParity.test.ts` snapshots rows and, for all four sorts,
the rows `WishlistScreen` lists into `apps/ios/NestTests/Fixtures/wishlist-parity.json`;
`WishlistParityTests` asserts `WishlistPresentation` lists the same.
