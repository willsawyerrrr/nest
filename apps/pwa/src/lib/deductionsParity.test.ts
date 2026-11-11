import { describe, expect, it } from 'vitest'
import { availableFinancialYears } from '@nest/household'
import {
  carExpenseDeductionCents,
  configsByYear,
  financialYearForDate,
  workFromHomeDeductionCents,
} from '@nest/tax'
import type { Tables } from './database.types'
import { droppedGroupId, groupDropId, UNGROUPED_DROP_ID } from './deductionDrop'
import { groupDeductions } from './deductionGroups'
import { workUseAmountCents } from './money'

/**
 * The deductions the native Deductions screen is held to. The rows are written
 * in full, as PostgREST returns them, and the figures are what the PWA computes
 * from them: the form's derived amounts (cents-per-km, fixed-rate hours, work-use
 * apportionment), the financial-year options, each group's payments and total,
 * and which drops the drag-and-drop filing accepts. The fixture is committed
 * beside the iOS tests (`vitest -u` rewrites it); `DeductionsParityTests` decodes
 * the same rows, runs the bundled engine and the screen's own functions, and
 * must return identical results.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/deductions-parity.json'
const STAMP = '2026-01-01T00:00:00Z'

const deduction = (
  id: string,
  member_id: string,
  amount_cents: number,
  overrides: Partial<Tables<'deduction'>> = {},
): Tables<'deduction'> => ({
  id,
  household_id: 'h1',
  member_id,
  financial_year: 2027,
  description: id,
  amount_cents,
  full_amount_cents: amount_cents,
  work_use_percent: 100,
  deduction_date: '2026-08-01',
  basis: 'amount',
  category: 'work_expense',
  distance_km: null,
  work_from_home_hours: null,
  group_id: null,
  created_at: STAMP,
  updated_at: STAMP,
  ...overrides,
})

const group = (
  id: string,
  member_id: string,
  kind: string,
  overrides: Partial<Tables<'deduction_group'>> = {},
): Tables<'deduction_group'> => ({
  id,
  household_id: 'h1',
  member_id,
  financial_year: 2027,
  kind,
  name: id,
  created_at: STAMP,
  updated_at: STAMP,
  ...overrides,
})

const groups = [
  group('adobe', 'm1', 'standard'),
  group('trip', 'm1', 'standard'),
  group('gifts', 'm1', 'donations'),
  group('other-member', 'm2', 'standard'),
  group('last-year', 'm1', 'standard', { financial_year: 2026 }),
]
const deductions = [
  deduction('adobe-1', 'm1', 5_999, { group_id: 'adobe' }),
  deduction('adobe-2', 'm1', 5_999, { group_id: 'adobe' }),
  deduction('flight', 'm1', 120_000, { group_id: 'trip' }),
  deduction('charity', 'm1', 5_000, { category: 'donation', group_id: 'gifts' }),
  deduction('laptop', 'm1', 60_000, {
    full_amount_cents: 100_000,
    work_use_percent: 60,
  }),
  deduction('commute', 'm1', 91_000, { basis: 'distance', distance_km: 1_000 }),
  deduction('wfh', 'm1', 7_000, { basis: 'hours', work_from_home_hours: 100 }),
  deduction('agent', 'm1', 25_000, { category: 'tax_agent_fees' }),
  deduction('theirs', 'm2', 9_900),
]

const figureInputs = [
  {
    financialYear: 2027,
    distanceKm: 1_000,
    hours: 100,
    fullAmountCents: 100_000,
    workUsePercent: 60,
  },
  {
    financialYear: 2026,
    distanceKm: 123.45,
    hours: 37.5,
    fullAmountCents: 33_333,
    workUsePercent: 33.33,
  },
  { financialYear: 2027, distanceKm: 6_000 },
  { financialYear: 2099, hours: 10, fullAmountCents: 1, workUsePercent: 0.01 },
  { financialYear: 2027 },
]

const figures = figureInputs.map((input) => {
  const config = configsByYear[input.financialYear] ?? configsByYear[2027]!
  return {
    input,
    expected: {
      centsPerKm: config.carExpense.centsPerKm,
      maxClaimableKm: config.carExpense.maxClaimableKm,
      centsPerHour: config.workFromHome.centsPerHour,
      distanceCents: carExpenseDeductionCents(input.distanceKm ?? 0, config),
      hoursCents: workFromHomeDeductionCents(input.hours ?? 0, config),
      apportionedCents: workUseAmountCents(input.fullAmountCents ?? 0, input.workUsePercent ?? 100),
    },
  }
})

const years = ['2026-06-30T23:59:59Z', '2026-07-01T00:00:00Z', '2027-03-15T10:00:00Z'].map(
  (now) => ({
    input: { now },
    expected: {
      current: financialYearForDate(new Date(now)),
      available: [...availableFinancialYears],
    },
  }),
)

const memberGroups = groups.filter((g) => g.member_id === 'm1' && g.financial_year === 2027)
const memberDeductions = deductions.filter((d) => d.member_id === 'm1')
const grouped = groupDeductions(memberGroups, memberDeductions)
const dropIds = [UNGROUPED_DROP_ID, ...groups.map((g) => groupDropId(g.id)), 'group:missing']
const household = {
  rows: { deductions, groups },
  expected: {
    memberTotalCents: memberDeductions.reduce((total, d) => total + d.amount_cents, 0),
    groups: grouped.groups.map(({ group: g, payments, totalCents }) => ({
      id: g.id,
      paymentIds: payments.map((p) => p.id),
      totalCents,
    })),
    ungroupedIds: grouped.ungrouped.map((d) => d.id),
    drops: memberDeductions.flatMap((d) =>
      dropIds.map((dropId) => ({
        deductionId: d.id,
        dropId,
        result: droppedGroupId(d, dropId, groups) ?? null,
        valid: droppedGroupId(d, dropId, groups) !== undefined,
      })),
    ),
  },
}

describe('the native Deductions parity fixture', () => {
  const text = `${JSON.stringify({ figures, years, household }, null, 2)}\n`

  it('matches what the PWA computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises apportioning, both derived bases, the cap and the drop rules', () => {
    expect(figures[0]?.expected.apportionedCents).toBe(60_000)
    expect(figures[2]?.input.distanceKm).toBeGreaterThan(figures[2]!.expected.maxClaimableKm)
    const valid = household.expected.drops.filter((drop) => drop.valid)
    expect(valid.length).toBeGreaterThan(0)
    expect(valid.length).toBeLessThan(household.expected.drops.length)
  })
})
