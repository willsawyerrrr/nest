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

## Summary

`Route.summary` is native (`SummaryScreen`): the allocation donut (Swift Charts
`SectorMark`) with a take-home/gross toggle (persisted in `UserDefaults`), stat
tiles and legend; allowance progress per member; the reconciliation ledger; and
the one-off money note. The figures come from the engine's `summariseHousehold`.
Planning mode is not yet native, so the screen always shows the real rows.

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
