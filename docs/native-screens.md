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
   primitives, rendered through `ScreenStateView`. The content sits in a
   `NestPageSection` (the PWA's `PageSection`: display title, optional intro,
   scrolling body); `docs/design-system.md` maps each PWA primitive to its
   native equivalent.

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

## Deductions

`Route.deductions` is native (`DeductionsScreen`): each member's deductions for a
financial year with a running total, groups of payments, the receipt-first Add card,
the bulk receipt review and drag-to-group filing, laid out like the web
`DeductionsScreen` (`FormKit.swift` in `DesignSystem/` holds the matching page title,
cards, inputs, segmented control, select, alert and Add button). Rows come from
`member`, `deduction` and `deduction_group` (scoped to the year, ordered as the PWA
hooks read them) and `deduction_receipt`. The financial-year picker offers the years the
engine reports (`financialYearOptions`), opening on the current one.

- **Add card.** Opens on the kind of deduction (work expense, donation, tax agent fee),
  the receipt input (a file, a photo, or files dropped on it) and "Enter details
  manually". One receipt is stored under the id the form minted and read through
  `deduction-extract` (primed for the kind); the read pre-fills the description, amount
  and date the member has not typed (`DeductionFormState.prefill`), and every failure
  reads as its own note without blocking the save. Several receipts go to the bulk
  review instead. A deduction saves through `create_deduction_with_receipt`.
- **Bases.** A work expense is a dollar amount (apportioned by a work-use percentage), a
  distance (cents per kilometre, with the ATO cap warning) or hours worked from home
  (fixed rate). The figures come from the engine's `deductionFigures`; a donation or tax
  agent fee is always claimed in full. Editing keeps the basis and reopens on the full
  cost.
- **Groups.** A group collapses to its name, payment count and total (summed from its
  payments). A payment's grip drags it onto a group, between groups, or onto the
  ungrouped list; valid targets are outlined while dragging (`DeductionDrop`, the rules
  of `deductionDrop.ts`). A donation files itself into the donations group and has no
  grip.
- **Uploads.** `Screens/Uploads/` holds the shared upload rules (25 MiB limit, stored
  content type, key names, HEIC to JPEG), the bulk queue (at most 20 files open, three
  read at once, independent failures, a halt when reading is off) and `BulkUploadPanel`,
  the review with Save selected. Receipts are stored in the private `receipts` bucket.
  The queue and review are reusable by any surface that reads uploaded documents.
- **Shared files.** Files shared from other apps reach the signed-in member's queue as
  described in [`ios.md`](ios.md#share-extension). Only Deductions takes them: a sheet
  over the shell opens it whichever screen is showing, and the Payslips screen never
  reads the inbox.

`apps/pwa/src/lib/deductionsParity.test.ts` computes the form figures (cents per
kilometre, fixed-rate hours, work-use apportionment), the year options, each group's
payments and total, and every drop's outcome with the PWA's own functions, and snapshots
rows and figures into `apps/ios/NestTests/Fixtures/deductions-parity.json`.
`DeductionsParityTests` runs the bundled engine and the screen's presentation over the same
rows and asserts identical results.

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


## Gifts

`Route.gifts` is native (`GiftsScreen`), drawn to match the PWA's Gifts tab: the
display title with Refresh and Manage, the collapsible "From your card" inbox
(link a candidate to a recipient's occasion, set it aside as "not a gift", undo),
the Total, "Unassigned purchases" (add, edit, delete, assign to a gift or the ad
hoc buffer) and "Ad hoc gifts" (edit the buffer amount, add, edit, delete a
purchase with an optional recipient tag) cards, the By occasion / By person
control (persisted in `UserDefaults` as `gift-group-by`), and a collapsible card
per group whose rows expand to their purchases (add, edit, delete). Refresh calls
the `up-sync` function, as the PWA does, then reloads. Writes are the PWA's own
PostgREST calls (`gift_purchase`, `gift_transaction_dismissal`,
`gift_discretionary_budget`) with the same field rules.

Totals, grouping, ordering, the inbox and the link choices are plain arithmetic,
so `GiftsPresentation` ports `lib/gifts.ts` and `lib/giftCandidates.ts` to Swift
rather than adding an engine entry point. `apps/pwa/src/lib/giftsParity.test.ts`
snapshots rows and those figures into `apps/ios/NestTests/Fixtures/gifts-parity.json`;
`GiftsParityTests` presents the same rows and asserts identical figures.

Still on the web: adding, editing and deleting recipients, occasions and gift
budgets. Manage opens a `WebHandoffCard` for them.

### Privacy

A member's own gift (a budget for a recipient linked to them) is not editable by
them, and purchases for it, or ad hoc purchases tagged to that recipient, are
hidden by row-level security (`private_gift`). The device never widens that:

- `gift_purchase` and `transactions` (the tables RLS withholds) bypass `RowCache`
  (`cached: false`), so only a fresh read is shown and no stale row can outlive a
  change to what RLS hides. The cache is otherwise keyed per user and cleared on
  sign-out.
- `GiftsRows.visible(to:)` drops those purchases again, with the transactions and
  dismissals they claim, before the content reaches the view model, so nothing
  hidden can reach the figures even through a stale response.
- A budget for the member's own gift reports no spend (as MCP `list_gifts` does):
  its row shows only the budget, and a group or total made up only of such gifts
  shows only the budget. Such budgets are left out of the link choices.
- Gift rows are not exposed to Spotlight or App Intents.

`GiftsViewModelTests` covers hidden rows never reaching the content or
presentation, the cache never serving another user's rows, purchases and
transactions never being cached, and the no-spend budget.

## Pay splits

`Route.splits` is native (`SplitsScreen`), laid out as the PWA's Splits page: the
"Paid into" chooser (spending accounts from `account_directory`, clearable), the
"Choose the account you're paid into" callout until one is set, a sort control
(title or amount, with a direction toggle, persisted in `UserDefaults`), the
"Stays in your pay account" panel, "Recommended pay splits" with its "N to
update" badge, and the Unassigned alert. Rows render as bordered cards on
compact widths and as dense ruled rows on regular widths, each expanding to the
budget lines behind its total. A drifted or never-confirmed row has the warning
stripe, an "Update" badge, the change (`was $350.00 → $400.00 / fn` or
`Not set yet`) and Confirm / Mark as set; a confirmed row has the subdued clear
control.

Routing comes from the engine's `paySplitRoutes` (in `packages/js-core`), which
runs `@nest/plan`'s `assignmentsByAccount` over the budget lines, goals and
allowances and returns accounts in routing order. `SplitsPresentation` mirrors
the rest of `SplitsScreen` in pure functions: rounding up to $5, drift,
recommended-versus-stays, sorting, and the PWA's copy. Rows are `budget_line`,
`savings_goal`, `account_directory`, `super_profile` (current financial year;
super-linked accounts are not split targets), `pay_split`, `households`
(`pay_account_id`), `members` and `member_allowance`.

Writes mirror `usePaySplits` and `usePayAccount`: Confirm upserts `pay_split` on
`household_id,account_id`, clear deletes by `account_id`, and the chooser calls
`set_household_pay_account` (a cleared account is sent as `null`). Each
invalidates its table's cache and reloads; a failed write shows a fixed message
and leaves the screen as it was. Nothing is left on the web.

`apps/pwa/src/lib/splitsParity.test.ts` computes the routing, rounded figures,
drift flags and grouping with the PWA's own plan functions for a household with
and without a pay account, and snapshots rows and figures into
`apps/ios/NestTests/Fixtures/splits-parity.json`. `SplitsParityTests` runs the
same rows through `SplitsRows.input`, the bundled engine and `SplitsPresentation`
and asserts identical figures.

## Payslips

`Route.payslips` is native (`PayslipsScreen`): one section per member with their
payslips for the current financial year, most recent pay period first, laid out as the
PWA's `PayslipsScreen`: the page title and intro, then per member the name and slip
count, the year-to-date grid (YTD gross, withheld, super, each with its variance and
coverage note), the reported-year-to-date cross-check, the year's position on pay no
period measures, the upload review, the slips and an **Add payslip** button. A slip is
a collapsed card (a dense row on a wide screen) showing the period, pay date, gross
and one headline variance pill; expanding it shows the gross / tax withheld / super /
net quartet with variances, the per-inflow earnings groups, the per-component tax
groups, the part-cycle and unmeasured-gross notes, the note and a link to the stored
document (a signed URL; a type that is not safe to show inline is saved, not rendered).
Adding, editing and deleting happen on the screen.

Rows are `members` and `inflows` (by name), `tax_profile`, `super_contribution` and
`deduction` (scoped to the year), `help_debt`, `payslip` (scoped to the year, `period_end`
descending) and `payslip_line`. The figures come from the engine's `payslipsOverview`
(`packages/js-core/src/payslips.ts`): it runs the household tax estimate over the rows,
measures each slip with `@nest/plan`'s `payslipVariance` against the member's annual
liability, HELP repayment and concessional contributions, and returns each member's
variances, year-to-date totals, reported totals, positions and unmeasured positions, the
measurements `PayslipsScreen` renders. `PayslipsPresentation` only looks them up and
words them (period and date labels, the headline pill, coverage and reported notes).
`apps/pwa/src/lib/payslipsParity.test.ts` computes them with the PWA's own
`lib/payslips.ts` and snapshots rows and figures into
`apps/ios/NestTests/Fixtures/payslips-parity.json`; `PayslipsParityTests` runs the same
rows through `PayslipsRows.input` and the bundled engine and asserts identical figures.

### Add and edit form

`PayslipFormView` mirrors the PWA's `PayslipForm`: pay period, paid-on date, the
gross / tax withheld / super / net quartet, earnings lines (each drawing on one of the
member's taxable inflows) and tax lines (each naming PAYG or STSL), salary sacrifice,
year-to-date figures and a note. The financial year is derived from the payment date, or
the period end where there is none, and shown back. `PayslipDraft` holds the state:
a read pre-fills only the fields and line kinds the member has not made their own (a
saved slip's figures are theirs from the start), an earnings line's inflow is matched
only by an exact name, and an unplaced tax line holds the save. `PayslipAttachmentModel`
stores a chosen document under the slip's id before reading it through `payslip-extract`
(the PWA's `usePayslipAttachment`): every failure is a note beside the editable figures,
and an object no saved row references is deleted when it is cleared, replaced or the
form is left. A slip and its lines save in one `upsert_payslip_with_lines` call under
the id the form minted, so a retry rewrites the same slip.

### Uploads

`Screens/Uploads/` holds what every surface that takes files shares:

- `UploadRules` — the PWA's `uploadFile.ts`: the 25 MiB limit and its message, content
  type and extractability decided by extension, safe storage key names, and HEIC/HEIF
  converted to JPEG where it decodes.
- `UploadQueue` — the native `useUploadQueue`: store, then read, then hand back a draft.
  At most three files are in flight and 20 open per panel (the rest are left out with
  the usual message); a failed, unreadable or unsupported file never stops the others;
  only a failure every file would meet (reading off) halts the queue; a retry does not
  store twice; a discarded, removed or abandoned file is deleted unless a saved record
  references it. Each file's id is minted when it is added and is the id of the record
  it becomes. A surface supplies `upload`, `discard`, `read`, `blank` and its
  unsupported-type message.
- `BulkUploadPanel` — the review: a card per file with its status, the surface's own
  form once read, and **Save selected (n)**, which runs each selected card's own
  validating save in turn with a progress bar and a summary.
- `FileImport` — copies picked or dropped files onto the app's disk (`PickedFile`) and
  turns a share-inbox item into one, so a surface can queue shared files.

Shared files from other apps join the deduction queue only (see
[`bulk-upload.md`](bulk-upload.md#receipts-shared-from-other-ios-apps)); the payslip
queue takes files picked or dropped on the Add card.

## Members and tax profiles

`Route.members` is native (`MembersScreen`), laid out as the PWA's: the page title,
a `Tax profiles (FY2027)` heading, and one item per member, a dense row on iPad and
Mac (name, residency pill, hospital-cover pill or a muted note, date of birth, an
`Edit <name>’s tax profile` pencil) and a bordered card on iPhone. The pencil swaps
the item for the inline editor (residency, private hospital cover, optional date of
birth with its termination-payment hint, Save and Cancel). A member with no profile
reads as a resident without cover.

It reads `members` (ordered by name) and `tax_profile` scoped to the current financial
year through `MembersViewModel`. Saving follows the PWA: the member's profile is
updated by member and year (inserted, with the household and year, when none exists),
then `set_member_date_of_birth` records the date (`null` clears it), then the rows
reload. There is no engine figure; the HELP debt balance is a separate PWA tab and
stays web.

`apps/pwa/src/lib/membersParity.test.ts` snapshots rows and what `TaxProfileList`
shows (including the en-AU `Sept` abbreviation) into
`apps/ios/NestTests/Fixtures/members-parity.json`; `MembersParityTests` asserts
`MembersPresentation` lists the same.

## Connections

`Route.connections` is native (`ConnectionsScreen`), laid out as the PWA's Connections
page: three cards (Connect Up, Connect a bank, Calendar feed). It reads `members`,
`redbark_connection` (newest first) and `calendar_feed` through `ConnectionsViewModel`.
`calendar_feed` is read with the columns the role may select (`NestRow.columns`), never
`token_hash`.

- **Up**: the signed-in member pastes a personal access token (a secure field, cleared on
  submit) which goes to `up-connect`; Disconnect calls `up-disconnect`. Every member's
  status reads Connected, Needs reconnecting or Not connected.
- **Bank**: `redbark-connect` returns a link session id and Redbark's hosted consent URL,
  which opens in the system browser with the web Connections page as the return address.
  The session id is kept in `UserDefaults` (`redbark-link-session-id`); on opening the
  screen and whenever the app becomes active, a kept id is resolved through
  `redbark-connect-complete` and cleared whatever the outcome. A connected result runs
  `redbark-sync` and refreshes the connections and account rows. Failures show the PWA's
  copy keyed on the edge function's `code` (`NestError.upstreamCode`). Only the signed-in
  member can disconnect their own connection (confirm alert, `redbark-disconnect`).
- **Calendar feed**: `create_calendar_feed_token` returns the plaintext token, shown once
  as `https` and `webcal` URLs with copy buttons; Regenerate and Revoke
  (`revoke_calendar_feed_token`).

Secrets (the Up token, the feed token) are held only for the call that uses them and are
never logged or cached. Edge-function and RPC failures show the error's fixed
`userMessage`. The screen has no engine figure, so there is no parity fixture;
`ConnectionsViewModelTests` cover load, failure, failed refresh keeping the cache, and each
action's success and failure.

## Notifications

`Route.notifications` is native (`NotificationsScreen`), laid out as the PWA's
`PushNotificationsCard`: the device badge (`On`, since the native app registers its
own APNs token and has no web opt-in) with its explanation, the "Send test
notification" button, and a "Notify me about" list of switches for the six
triggers the PWA offers, each with its label and description, under the
"These apply to every device you've turned on." note. A test result or failure shows
as a tinted notice below.

It reads `notification_preference` (row-level security returns only the caller's
rows; an absent row means on) and `members` through `NotificationsViewModel`. A
switch upserts `{ household_id, member_id, trigger, enabled }` on `member_id,trigger`
(`NestData.upsert`, `Prefer: resolution=merge-duplicates`), the member being the
`members` row whose `user_id` is the session user, then reloads; the switch shows its
new value while the write is in flight and reverts if it fails. The test button calls
the `push-test` edge function and `NotificationsPresentation.describe` words the
counts as the PWA's `describeTestResult` does.

There is no engine figure: tests cover the copy, trigger order, defaults and test
wording (`NotificationsPresentationTests`) and loading, failure, a failed refresh
keeping the cache, toggling and the test send (`NotificationsViewModelTests`).

## What's new

`Route.whatsNew` is native (`WhatsNewScreen`), outside the nav and reached from the
shell's What's new button. It is laid out as the PWA's `ChangelogScreen`: the page
title, an "Update available" alert, an In progress section and an Implemented
section. Each change is a compact row (type emoji, description clamped to two
lines, date); a clamped row shows a chevron and expands on tap, and the date sits in
a 96pt right column from 768pt and under the description below.

The changelog is the PWA's own source: the `changelog` edge function, called
through `SupabaseAPI.invoke` and decoded as `Changelog`, every list newest first as
the function returns it. The native app sends no commit SHA, so `available` is
empty; the update alert comes from a version check instead of the PWA's reload
prompt. A failed load shows the PWA's inline error alert, not `ErrorView`.

`VersionSource` compares the bundle's `CFBundleShortVersionString` with the latest
release on the app's channel (`UpdateChannel`): the App Store on iOS and Mac
Catalyst (an iTunes lookup by bundle id, linking to `trackViewUrl`), and Homebrew on
`NestMac` (the `version` in the tap's `Casks/nest.rb`, shown with
`brew upgrade --cask willsawyerrrr/tap/nest`). `AppVersion` compares numerically
per component. A failed lookup, or no published release, offers no update; a failed
changelog fails the screen. Current version, latest release and changelog are
injected, so tests stub all three.

## Household

`Route.household` is native (`HouseholdScreen`), laid out as the PWA's `HouseholdScreen`:
a card with the household name, `Signed in as <email>` and Sign out, and an
"Invite someone" card. It reads `households` (the first row, as the PWA picks it)
through `HouseholdViewModel`; the email comes from the native session.

Sign out unregisters the push token and clears the native session, as the web
view's `nestAuth` request does. The invite card shows the code, a Copy button
(which reads Copied for a second), the single-use hint with `Expires in N days`
(or `Expires within a day`), Regenerate and Revoke; with no code, or an expired
one, it offers Create invite code. Create and Regenerate call `create_invite_code`,
Revoke calls `revoke_invite_code`, each invalidating `households`. A failed call
shows a fixed alert.

There is no engine figure and no parity fixture; `HouseholdPresentationTests`
pin the copy, the day rounding and the timestamp parsing.
