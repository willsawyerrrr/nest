import { describe, expect, it } from 'vitest'
import { fortnightlyCents } from '@nest/plan'
import { breakdownTotalsByBreakdownId, derivedAmountContext } from './breakdowns'
import type { Tables } from './database.types'

/**
 * The breakdowns the native Breakdowns screens are held to. The rows are written
 * in full, as PostgREST returns them, and the figures are what the PWA computes
 * from them: each breakdown's rolled-up total (`breakdownTotalsByBreakdownId`,
 * drawn per fortnight as `BreakdownsScreen` does) and each item's fortnightly
 * figure (as `BreakdownDetail` does). The fixture is committed beside the iOS
 * tests (`vitest -u` rewrites it); `BreakdownsParityTests` decodes the same rows,
 * runs the bundled engine and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/breakdowns-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const breakdown = (
  id: string,
  name: string,
  line_group: Tables<'breakdown'>['line_group'],
): Tables<'breakdown'> => ({ ...base, id, name, line_group, kind: 'generic' })

const item = (
  id: string,
  breakdown_id: string,
  amount_cents: number,
  frequency: Tables<'breakdown_item'>['frequency'],
  interval_count: number | null = null,
): Tables<'breakdown_item'> => ({
  ...base,
  id,
  breakdown_id,
  name: id,
  amount_cents,
  frequency,
  interval_count,
})

const breakdowns = [
  breakdown('b1', 'Utilities', 'needs'),
  breakdown('b2', 'Medications', 'needs'),
  breakdown('b3', 'Holiday extras', 'wants'),
]
const items = [
  item('power', 'b1', 300_00, 'monthly'),
  item('water', 'b1', 400_00, 'quarterly'),
  item('internet', 'b1', 25_00, 'weekly'),
  item('script', 'b2', 333_33, 'every_n_weeks', 3),
  item('vitamins', 'b2', 777_77, 'every_n_months', 5),
  item('checkup', 'b2', 90_00, 'biannual'),
]

const totals = breakdownTotalsByBreakdownId(
  breakdowns,
  derivedAmountContext(breakdowns, items, [], [], null),
)
const expected = {
  totals: breakdowns.map(({ id }) => ({
    breakdownId: id,
    annualCents: totals.get(id) ?? 0,
    fortnightlyCents: fortnightlyCents(totals.get(id) ?? 0, 'annual'),
  })),
  items: items.map((row) => ({
    itemId: row.id,
    fortnightlyCents: fortnightlyCents(
      row.amount_cents,
      row.frequency,
      row.interval_count ?? undefined,
    ),
  })),
}

describe('the native Breakdowns parity fixture', () => {
  const text = `${JSON.stringify([{ name: 'three breakdowns', rows: { breakdowns, items }, expected }], null, 2)}\n`

  it('matches what the PWA Breakdowns screens compute from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises interval frequencies, rounding and an empty breakdown', () => {
    expect(expected.totals[2]).toEqual({ breakdownId: 'b3', annualCents: 0, fortnightlyCents: 0 })
    expect(expected.totals[1]?.annualCents).toBeGreaterThan(0)
  })
})
