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

`apps/pwa/src/lib/taxParity.test.ts` does the same for the Tax estimate and EOFY
screens: it computes, with the PWA's own lib functions, the estimate (withholding,
HELP, a capital gain, projected interest and a joint inflow included), each member's
super cap summary, HELP payoff and payslip count, the household year summary and
Medicare levy surcharge test, the private-hospital-cover what-if, a salary-sacrifice
what-if and the planning baseline, and snapshots
`apps/ios/NestTests/Fixtures/tax-parity.json`. `TaxParityTests` runs
`TaxRows.input` through the bundled engine and asserts identical figures.

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

## Goals

`Route.goals` is native (`GoalsScreen`), laid out as the PWA's Goals page: the
Refresh button (an `up-sync` edge-function call, also on pull-to-refresh), the
funded goals, the full-width lime "Add goal" button, and an Upcoming section for
queued goals. A goal is a bordered card below 768pt (name, status badge, `$balance of
$target`, percent, progress bar, ETA line, synced-saver note, linked contribution)
and a dense table row from 768pt (name and badge, percent, progress, target,
fortnightly funding, controls, ETA caption), as `GoalList` renders by width.

Rows are `savings_goal` (ordered by `queue_position`, `name`), `budget_line`,
`accounts_with_balance` (`source != manual`, `type = savings`, the savers a goal
links to) and `members`. `GoalsEngine` reads each goal's funding from the engine's
`budgetOverview` (a line's fortnightly figure without its interval, as the PWA's
`contributionForGoal` reads it) and projects the whole list with `projectGoalQueue`;
`GoalsPresentation` partitions funded from queued goals (queued by position then
name) and builds each status flag and ETA line, mirroring `goalDisplay` and
`queuedGoalDisplay`. Under planning mode the sandboxed rows are projected and the
real rows are projected again as the baseline, so a funding or ETA the sandbox moved
reads `real → proposed (±change)`.

Writes use the PWA's calls: `POST`, `PATCH` and `DELETE` on `savings_goal`, every
column sent (`null` included) so clearing a field clears it. The form
(`GoalForm`/`GoalDraft`) has the PWA's fields, validation (name and target required)
and copy; delete asks for confirmation. Dragging a queued goal's grip onto another
queued goal moves it there and rewrites `queue_position` for the goals that moved
(as `reorderQueue` does, and the MCP `reorder_savings_goal_queue`); VoiceOver gets
Move up and Move down actions. While planning mode is on, create, edit, delete and
reorder go to the sandbox (`PlanningStore.create`/`update`/`delete`), not the database.

The page title is the shell's navigation title. A wishlist item promoted to a goal
is not picked up natively yet.

`apps/pwa/src/lib/goalsParity.test.tsx` computes each goal's funding, progress, status
flag and ETA with the PWA's own `goalProjection` helpers and snapshots rows and
figures into `apps/ios/NestTests/Fixtures/goals-parity.json`; `GoalsParityTests` runs
the same rows through `GoalsEngine` and `GoalsPresentation` over the bundled engine
and asserts identical figures.

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
- Goals creates, edits, deletes and reorders into the sandbox. Creating a budget line
  or an inflow in the sandbox is not offered natively yet; the layer already holds,
  applies, lists and saves a created row (as one made in the web app's sandbox shape
  would be).

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

## Tax estimate and EOFY

`Route.tax` (`TaxScreen`) and `Route.eofy` (`EofyScreen`) are native, sharing
`TaxRows`, `TaxViewModel` (`Mode.tax` / `Mode.eofy`) and `TaxPresentation`, laid out
as the PWA's `TaxEstimateView` and `EofyScreen` (cards, type, spacing and copy).
Rows are scoped to the financial year as the PWA hooks scope them (`tax_profile`,
`super_contribution`, `super_profile`, `deduction`, `payslip`, and on EOFY
`deduction_group`), and the figures come from the engine's `taxScreen`
(`packages/js-core/src/taxScreen.ts`), which runs the same estimate, super cap
summary, HELP payoff and payslip withholding the PWA runs; the screens only label
and split them.

- **Tax** shows the Household card and a card per member: take-home headline,
  gross and total tax, the take-home-versus-tax bar, the one-off and capital-gain
  notes, the withholding position, the HELP payoff line, the gross-to-take-home
  waterfall and income and tax build-up tables behind "Show breakdown", the
  salary-sacrifice what-if (`salarySacrifice`), and the Medicare levy surcharge
  what-if for private hospital cover (`mlsWhatIf`). While planning mode is on the
  estimate is computed from the sandboxed inflows and goals and from the real ones,
  and each card shows `real → proposed (±change)`.
- **EOFY** reads the selected financial year (any year with a tax config): the
  share control, the Household year summary with the Medicare levy surcharge test
  (`householdYear`, the dependent-children count is local state), and a card per
  member with the tax estimate and withholding position, deductions (grouped, each
  with its receipt link and workings), super caps, HELP debt and payslip documents.
  Receipt and payslip links sign a short-lived Storage URL on tap and open it.
- **Share link** creation calls the `share-create` edge function and revoking calls
  `revoke_share_grant`, as the PWA does (see [`eofy-sharing.md`](eofy-sharing.md)).
  The plaintext link is shown once after creation, with Copy link; the share page
  `/share/eofy/:token` stays web.

The Tax estimate and EOFY entries in the nav are unchanged; the screens register
only through `Route.content`.
## Inflows

`Route.inflows` is native (`InflowsScreen`), read and write: the household's inflows
(ordered by name, with ended inflows and paid one-offs sunk to the bottom and dimmed),
and the add/edit form with every field the web form has (taxability, member, type,
recurring or one-off, frequency and interval, amount or a wage's rate and hours, the
pay cadence and its interval, arrives-every-pay-period, employer super, joint income
and its split, confirmed payday, effective dates, and a one-off's date, tax treatment
and years of service). It follows the PWA's look: a bordered card per inflow on a
compact width and a dense ruled row (name, type, amount, cadence badge, fortnightly
figure) on a wide one, the lime add button, the inline form on the elevated surface
with each field's label and dimmed description, and the delete confirmation. The form
controls live in `InflowFormControls.swift`.

`InflowFormState` holds the form's rules (what a change resets, `canSubmit`, the
columns a save writes) as the PWA's `InflowForm` does, so a save sends the same
`InflowInput` columns, with every unset one an explicit `null`. A create inserts with
the household id; an edit patches by id; a delete removes by id. While planning mode
is on the three writes go into the sandbox's `inflows` layer instead (`PlanningStore.create`
holds a created row), as the web app's household collection does, and the screen shows
the sandboxed rows.

Figures come from two engine entry points in `packages/js-core`: `summariseInflows`
(each inflow's fortnightly figure from its annualised gross, `null` for a one-off) and
`previewInflowDraft` (the stated annual total, the per-payment note and a one-off's
tax-free, assessable and concessional split, shown under the fields as the web form
does). `describePerPayment` and `previewOneOffPaymentSplit` live in `@nest/plan` and
`@nest/household` so the web form and the engine share them. `InflowsPresentation`
mirrors `InflowList`'s labels and captions. Parity is held by
`apps/pwa/src/lib/inflowsParity.test.ts`, which computes the fortnightly figures and
the form's draft figures with the PWA's own functions and snapshots rows and figures
into `apps/ios/NestTests/Fixtures/inflows-parity.json`; `InflowsParityTests` runs the
same rows and drafts through the bundled engine and asserts identical figures.
