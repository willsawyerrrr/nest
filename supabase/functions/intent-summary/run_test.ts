import { assert, assertEquals } from '@std/assert'
import { FORTNIGHTS_PER_YEAR } from '@nest/plan'
import { FY2027_CONFIG } from '@nest/tax'
import {
  type BudgetSummaryBundle,
  estimateHouseholdTaxFromRows,
  type InflowRow,
} from '@nest/household'
import { type IntentSummaryDeps, runIntentSummary } from './run.ts'

const NOW = new Date('2026-12-01T00:00:00Z')

const salary: InflowRow = {
  member_id: 'm1',
  taxable: true,
  type: 'salary',
  schedule: 'annual',
  amount_cents: 120_000_00,
  hourly_rate_cents: null,
  hours_per_period: null,
  interval_count: null,
  starts_on: null,
  ends_on: null,
  paid_on: null,
  attracts_super: true,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
}

function fakeBundle(overrides: Partial<BudgetSummaryBundle> = {}): BudgetSummaryBundle {
  return {
    inflows: [salary],
    taxProfiles: [{ member_id: 'm1', residency: 'resident', has_private_hospital_cover: false }],
    contributions: [],
    helpDebts: [],
    deductions: [],
    members: [{ id: 'm1', date_of_birth: null }],
    budgetLines: [{
      line_group: 'needs',
      amount_cents: 1_000_00,
      frequency: 'fortnightly',
      interval_count: null,
    }],
    temporaryItems: [],
    savingsGoals: [],
    savers: [],
    ...overrides,
  }
}

function deps(overrides: Partial<IntentSummaryDeps> = {}): IntentSummaryDeps {
  return {
    now: () => NOW,
    resolveHousehold: () => Promise.resolve({ householdId: 'h-1' }),
    loadBundle: () => Promise.resolve(fakeBundle()),
    ...overrides,
  }
}

Deno.test('runIntentSummary returns the fortnightly after-saving buffer for the household', async () => {
  const result = await runIntentSummary(deps())
  const b = fakeBundle()
  const estimate = estimateHouseholdTaxFromRows(
    b.inflows,
    b.taxProfiles,
    b.contributions,
    b.helpDebts,
    b.deductions,
    FY2027_CONFIG,
  )
  const expected = Math.round(estimate.annualAfterTaxCents / FORTNIGHTS_PER_YEAR) - 1_000_00
  assertEquals(result, { status: 200, body: { fortnightlyAfterSavingCents: expected } })
})

Deno.test('runIntentSummary loads the bundle for the resolved household', async () => {
  let loadedFor: string | null = null
  await runIntentSummary(deps({
    resolveHousehold: () => Promise.resolve({ householdId: 'h-42' }),
    loadBundle: (householdId) => {
      loadedFor = householdId
      return Promise.resolve(fakeBundle())
    },
  }))
  assertEquals(loadedFor, 'h-42')
})

Deno.test('runIntentSummary propagates a caller-resolution error and never loads a bundle', async () => {
  let loaded = false
  const result = await runIntentSummary(deps({
    resolveHousehold: () =>
      Promise.resolve({ error: { status: 404, message: 'No household membership for this user' } }),
    loadBundle: () => {
      loaded = true
      return Promise.resolve(fakeBundle())
    },
  }))
  assertEquals(result, { status: 404, body: { error: 'No household membership for this user' } })
  assert(!loaded)
})

Deno.test('runIntentSummary passes an unauthorised caller straight through', async () => {
  const result = await runIntentSummary(deps({
    resolveHousehold: () =>
      Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
  }))
  assertEquals(result, { status: 401, body: { error: 'Invalid authorization' } })
})
