import { describe, expect, it } from 'vitest'
import {
  exerciseCostCents,
  grantValueCents,
  grossVestedValueCents,
  heldShareQuantity,
  vestedQuantity,
} from '@nest/plan'
import type { Tables } from './database.types'
import { formatIsoDate } from './dates'
import {
  EQUITY_INSTRUMENT_TYPES,
  equityGrantToPlan,
  grantHoldings,
  VESTING_FREQUENCIES,
} from './equity'
import { formatCents } from './money'

/**
 * The equity the native Equity screen is held to. The rows are written in full, as
 * PostgREST returns them; the figures are what `EquityScreen` draws: each grant's
 * vested, exercised, sold and held units and values (`@nest/plan` over
 * `equityGrantToPlan`), and the labels it builds from them. The fixture is
 * committed beside the iOS tests (`vitest -u` rewrites it); `EquityParityTests`
 * decodes the same rows, runs the bundled engine and must produce identical
 * figures and labels.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/equity-parity.json'
const NOW = '2026-11-11T12:00:00Z'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  user_id: `u-${id}`,
  email: null,
  date_of_birth: null,
  up_connected_at: null,
  up_sync_failed_at: null,
})

const grant = (
  id: string,
  member_id: string,
  label: string,
  fields: Partial<Tables<'equity_grant'>>,
): Tables<'equity_grant'> => ({
  ...base,
  id,
  member_id,
  label,
  instrument_type: 'option',
  quantity: 1_000,
  grant_date: '2025-01-01',
  cliff_months: 12,
  vesting_period_months: 48,
  vesting_frequency: 'monthly',
  strike_price_cents: 100,
  price_per_share_cents: 300,
  price_as_of: null,
  ...fields,
})

const exercise = (
  id: string,
  member_id: string,
  grant_id: string,
  exercised_on: string,
  quantity: number,
  market: number | null,
): Tables<'equity_exercise'> => ({
  ...base,
  id,
  member_id,
  grant_id,
  exercised_on,
  quantity,
  strike_price_cents: 50,
  market_price_per_share_cents: market,
})

const sale = (
  id: string,
  member_id: string,
  grant_id: string,
  sold_on: string,
  quantity: number,
  fee_cents: number,
): Tables<'equity_sale'> => ({
  ...base,
  id,
  member_id,
  grant_id,
  sold_on,
  quantity,
  price_per_share_cents: 250,
  fee_cents,
})

const members = [member('m1', 'Ada'), member('m2', 'Ben'), member('m3', 'Cy')]
const grants = [
  grant('g1', 'm1', 'Acme options', {
    quantity: 10_000,
    grant_date: '2024-03-15',
    strike_price_cents: 50,
    price_per_share_cents: 250,
  }),
  grant('g2', 'm1', 'Acme shares', {
    instrument_type: 'share',
    quantity: 4_000,
    grant_date: '2025-01-01',
    cliff_months: 6,
    vesting_period_months: 24,
    vesting_frequency: 'quarterly',
    strike_price_cents: null,
    price_per_share_cents: 400,
  }),
  grant('g3', 'm2', 'Beta options', {
    quantity: 1_000,
    grant_date: '2026-10-01',
    vesting_frequency: 'annual',
  }),
]
const exercises = [
  exercise('e1', 'm1', 'g1', '2025-08-30', 2_000, 275),
  exercise('e2', 'm1', 'g1', '2026-02-10', 1_000, null),
]
const sales = [
  sale('s1', 'm1', 'g1', '2026-05-01', 500, 995),
  sale('s2', 'm1', 'g2', '2026-04-20', 300, 0),
]

const instrumentLabel = (type: string) =>
  EQUITY_INSTRUMENT_TYPES.find((entry) => entry.value === type)?.label ?? type
const frequencyLabel = (frequency: string) =>
  VESTING_FREQUENCIES.find((entry) => entry.value === frequency)?.label ?? frequency

const asOf = new Date(NOW)
const figures = grants.map((row) => {
  const plan = equityGrantToPlan(row, exercises, sales)
  const { exercised, sold } = grantHoldings(row, exercises, sales)
  return {
    grantId: row.id,
    vested: vestedQuantity(plan, asOf),
    exercised,
    sold,
    held: heldShareQuantity(plan, asOf),
    grossCents: grossVestedValueCents(plan, asOf),
    exerciseCents: exerciseCostCents(plan, asOf),
    netCents: grantValueCents(plan, asOf),
  }
})

/** The activity caption `EquityScreen` builds, `null` when no unit has moved. */
const activity = (exercised: number, sold: number, held: number) => {
  const parts = [
    exercised > 0 ? `${exercised.toLocaleString()} exercised` : null,
    sold > 0 ? `${sold.toLocaleString()} sold` : null,
    exercised > 0 || sold > 0 ? `${held.toLocaleString()} shares held` : null,
  ].filter((part) => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

const grantLabel = (id: string) => grants.find((row) => row.id === id)?.label ?? 'Grant'

const expectedMembers = members.map((owner) => {
  const owned = grants.filter((row) => row.member_id === owner.id)
  return {
    id: owner.id,
    name: owner.name,
    grants: owned.map((row) => {
      const figure = figures.find((entry) => entry.grantId === row.id)!
      return {
        id: row.id,
        label: row.label,
        instrumentLabel: instrumentLabel(row.instrument_type),
        isOption: row.instrument_type === 'option',
        frequencyLabel: frequencyLabel(row.vesting_frequency),
        vestedLabel: `${figure.vested.toLocaleString()} / ${row.quantity.toLocaleString()} vested`,
        netCents: figure.netCents,
        valueLine:
          row.instrument_type === 'option'
            ? `Vested value ${formatCents(figure.grossCents)} · Exercise cost ${formatCents(figure.exerciseCents)}`
            : null,
        activityLine: activity(figure.exercised, figure.sold, figure.held),
      }
    }),
    exercises: owned.some((row) => row.instrument_type === 'option')
      ? exercises
          .filter((row) => row.member_id === owner.id)
          .map((row) => ({
            id: row.id,
            title: `${row.quantity.toLocaleString()} × ${grantLabel(row.grant_id)}`,
            detail: [
              formatIsoDate(row.exercised_on),
              `strike ${formatCents(row.strike_price_cents)}`,
              row.market_price_per_share_cents === null
                ? null
                : `market ${formatCents(row.market_price_per_share_cents)}`,
            ]
              .filter((part) => part !== null)
              .join(' · '),
          }))
      : null,
    sales:
      owned.length > 0
        ? sales
            .filter((row) => row.member_id === owner.id)
            .map((row) => ({
              id: row.id,
              title: `${row.quantity.toLocaleString()} × ${grantLabel(row.grant_id)}`,
              detail: [
                formatIsoDate(row.sold_on),
                `${formatCents(row.price_per_share_cents)} per share`,
                row.fee_cents > 0 ? `fees ${formatCents(row.fee_cents)}` : null,
              ]
                .filter((part) => part !== null)
                .join(' · '),
            }))
        : null,
  }
})

describe('the native Equity parity fixture', () => {
  const text = `${JSON.stringify(
    [
      {
        name: 'options, shares and an unvested grant',
        now: NOW,
        rows: { grants, exercises, sales, members },
        expected: { figures, members: expectedMembers },
      },
    ],
    null,
    2,
  )}\n`

  it('matches what the PWA Equity screen computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises exercised and sold units, a share grant, an unvested grant and a member with none', () => {
    expect(figures[0]).toMatchObject({ exercised: 3_000, sold: 500, held: 2_500 })
    expect(figures[2]).toMatchObject({ vested: 0, netCents: 0 })
    expect(expectedMembers[2]).toMatchObject({ grants: [], exercises: null, sales: null })
    expect(expectedMembers[1]?.exercises).toEqual([])
  })
})
