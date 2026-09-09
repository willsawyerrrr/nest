# WSD-132 — Extract household row-shaping into `@nest/household`

## Problem

`apps/pwa/src/lib/{tax,summary}.ts` shape raw DB rows into `@nest/plan` /
`@nest/tax` engine inputs and run the household tax estimate and fortnightly
buffer. That code is React-free but lives in the PWA, so
`supabase/functions/_shared/householdBuffer/{summary,tax,adapters}.ts` is a
hand-maintained Deno port of the same logic, kept honest only by matching
function names and review. Two implementations of the numbers a household files
a tax return on and asks Siri about.

## Decisions (both blocking tickets already resolved)

- **WSD-151** (`forHousehold` dedup) — already Done (#428). `readHouseholdTable`
  is the shared reader; keep it shared in whatever file the I/O glue lands in.
- **WSD-173** (derived budget lines) — already Done (#445). The server trusts
  `budget_line.amount_cents`; the PWA still re-derives. So `@nest/household`'s
  `summariseHouseholdFromRows` **trusts the row**; the PWA `summariseHousehold`
  wrapper keeps `applyBreakdownAmounts` and passes already-resolved lines in.
- **New package, not a fold into `@nest/plan`.** `@nest/plan` is contractually
  tax-free ("no dependency on the tax package"). The household shaping runs
  `estimateHouseholdTax`, so it needs `@nest/tax`. New `@nest/household` depends
  on both.
- **Loose row interfaces owned by the package** — snake_case, matching DB column
  names, a structural subset of the PWA hook types and of what PostgREST returns.
  The PWA passes its hook rows straight in (structurally assignable); the edge
  functions pass PostgREST JSON.
- **Golden-fixture parity** — a `.ts` fixture module in the package holding
  `{ label, input, expected }` cases for `estimateHouseholdTaxFromRows` and
  `summariseHouseholdFromRows`; a vitest test runs them through the package, a
  deno test runs the same cases through the **vendored** copy and asserts equal.
  A divergence then fails a test rather than resting on review.

## Package surface (`@nest/household`)

Row interfaces: `InflowRow`, `TaxProfileRow`, `SuperProfileRow`,
`SuperContributionRow`, `HelpDebtRow`, `DeductionRow`, `MemberRow`,
`BudgetLineRow`, `TemporaryItemRow`, `InterestGoalRow`, `SaverRow`,
`AccountRow`, `BalanceRow`.

Bundles: `TaxEstimateRows`, `BudgetSummaryBundle`.

Functions (moved verbatim from `lib/tax.ts` / `lib/summary.ts`, re-typed to the
loose rows):

- tax: `atPreservationAgeOn`, `toIncomeInput`, `inflowIncomeInputs`,
  `splitAcrossMembers`, `splitByPercent`, `projectedInterestIncomeInputs`,
  `activeNowTaxableInflows`, `helpDebtCentsByMember`, `deductionsByMember`,
  `concessionalByMember`, `nonConcessionalByMember`,
  `grossByMemberFromInflows`, `assessableByMemberFromInflows`,
  `superCapSummaryByMember`, `superCapSummaryFromRows`,
  `netAnnualSuperContributionByMember`, `netAnnualSuperContributionFromRows`,
  `estimateHouseholdTaxFromRows`, `helpPayoffForBreakdown`, `helpPayoffSummary`,
  `helpPayoffByMember`, `currentTaxConfig`, `availableFinancialYears`,
  consts `ENGINE_ONE_OFF_TREATMENTS`, `HELP_PAYOFF_MAX_YEARS`
- summary: `toSummaryInput` (row core, no `applyBreakdownAmounts`),
  `summariseHouseholdFromRows`, type `SuperCapSummary`

`estimateHouseholdTaxFromRows` — reconcile the PWA signature
`(inflows, profiles, contributions?, helpDebts?, deductions?, config?, paygWithheld?, members?, extraIncomes?)`
with the mirror's `({...rows}, config, extraIncomes?)`. Keep the PWA positional
signature (more callers); the mirror's bundle callers adapt.

## Files

**New**
- `packages/household/package.json`, `tsconfig.json`, `vite.config.ts`
- `packages/household/src/index.ts`
- `packages/household/src/rows.ts` — loose row interfaces + bundles
- `packages/household/src/tax.ts` — the tax row-shaping (from `lib/tax.ts`)
- `packages/household/src/summary.ts` — `toSummaryInput` core + `summariseHouseholdFromRows`
- `packages/household/src/*.test.ts` — migrated from `lib/tax.test.ts` /
  `lib/summary.test.ts` (the row-shaping cases) + the deleted mirror tests
- `packages/household/src/goldenCases.ts` — parity fixtures
- `packages/household/src/parity.test.ts` — vitest parity run
- `supabase/functions/_shared/householdBuffer_parity_test.ts` — deno parity run
- `supabase/functions/_shared/vendor/household/**` — generated

**Modified**
- `apps/pwa/src/lib/tax.ts` — thin: `export * from '@nest/household'` + any
  PWA-typed shim; drop the moved bodies. Keep `lib/tax.test.ts` for whatever
  stays.
- `apps/pwa/src/lib/summary.ts` — `summariseHousehold` wrapper stays (planning
  sandbox + `applyBreakdownAmounts`), delegates the core to the package.
- `apps/pwa/package.json` — add `@nest/household` dep
- `supabase/functions/_shared/householdBuffer/` → flatten to
  `_shared/householdBuffer.ts`: keeps `readHouseholdTable`,
  `loadBudgetSummaryBundle`, `toSaverRows`, `AccountRow`/`BalanceRow`; imports
  the pure bits from `@nest/household`. Delete `summary.ts`, `tax.ts`,
  `adapters.ts`, `bundle.ts` and their `_test.ts`.
- `supabase/functions/notify-eval/{eval,index}.ts`,
  `supabase/functions/intent-summary/{run,index}.ts` — repoint imports.
- `scripts/vendor-edge-packages.js` — `PACKAGES = ['plan', 'tax', 'household']`
- `supabase/functions/deno.json` — add the `@nest/household` import map entry
- `vitest.config.ts` — add `packages/household/src/**` to coverage `include`;
  add a `packages/household/**` 100% threshold block; exclude `goldenCases.ts`
- docs: `docs/architecture.md` (packages list + CI vendor line),
  `supabase/functions/README.md` (the householdBuffer section),
  `CLAUDE.md` (the `_shared/householdBuffer/...` mentions), `docs/tax.md`,
  `docs/notifications.md` / `docs/ios.md` if they name the mirror files

## Order of work (commits)

1. Scaffold `packages/household` (config + empty index) + wire into
   `apps/pwa/package.json`, `vitest.config.ts`, vendor script, `deno.json`.
2. Move the tax row-shaping into `packages/household/src/tax.ts` + `rows.ts`;
   `lib/tax.ts` re-exports; migrate the row-shaping tests. PWA green.
3. Move the summary core into `packages/household/src/summary.ts`; `lib/summary.ts`
   wrapper delegates; migrate tests. PWA green.
4. Repoint the edge functions to vendored `@nest/household`; flatten
   `_shared/householdBuffer/` to one file; delete the mirror + its tests;
   `pnpm vendor:edge`. Deno green.
5. Golden-fixture parity suite (vitest + deno).
6. Docs.

## Risks

- Coverage: `packages/household/**` gates at 100%. The moved code is well-covered
  today (PWA lib tests + mirror deno tests); the migrated suite must reach 100%
  branch on the new file layout.
- `exactOptionalPropertyTypes` — the loose rows use `x: T | null` and the
  functions spread `...(x != null && { ... })`; keep that exact idiom.
- `estimateHouseholdTaxFromRows` signature reconciliation — the mirror callers
  (`bundle`-shaped) must adapt to the positional PWA signature without changing
  any number.
- Vendor script copies `.ts` only — fixtures must be `.ts`, not `.json`.
- CI `functions` job and `<1 min` budget — the deno suite shrinks; watch the
  vitest package project doesn't slow a shard past budget.
