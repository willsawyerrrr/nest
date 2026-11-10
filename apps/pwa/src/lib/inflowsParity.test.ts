import { describe, expect, it } from 'vitest'
import {
  annualInflowGrossCents,
  describePerPayment,
  fortnightlyCents,
  type Frequency,
} from '@nest/plan'
import { annualGrossCents, FY2027_CONFIG } from '@nest/tax'
import type { Tables } from './database.types'
import { EMPTY_ONE_OFF_DRAFT, previewOneOffSplit } from './oneOffInflow'
import { toIncomeInput } from './tax'

/**
 * The inflows the native Inflows screen is held to. The rows are written in full, as
 * PostgREST returns them, and the figures are what the PWA computes from them: each
 * inflow's fortnightly figure (as `InflowList` does, null for a one-off) and the
 * figures the add/edit form shows back from a draft (the stated annual total, the
 * per-payment note and a one-off's split). The fixture is committed beside the iOS
 * tests (`vitest -u` rewrites it); `InflowsParityTests` decodes the same rows, runs
 * the bundled engine and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/inflows-parity.json'
const STAMP = '2026-01-01T00:00:00Z'

type Inflow = Tables<'inflows'>

const inflow = (id: string, overrides: Partial<Inflow>): Inflow => ({
  id,
  household_id: 'h1',
  created_at: STAMP,
  updated_at: STAMP,
  name: id,
  taxable: true,
  member_id: 'm1',
  type: 'salary',
  attracts_super: true,
  schedule: 'annual',
  amount_cents: null,
  hourly_rate_cents: null,
  hours_per_period: null,
  interval_count: null,
  pay_schedule: null,
  pay_interval_count: null,
  arrives_every_pay_period: true,
  starts_on: null,
  ends_on: null,
  paid_on: null,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
  pay_anchor_date: null,
  ...overrides,
})

const inflows = [
  inflow('salary', { amount_cents: 120_000_00, pay_schedule: 'fortnightly' }),
  inflow('wage', {
    type: 'wage',
    schedule: 'weekly',
    hourly_rate_cents: 45_50,
    hours_per_period: 37.5,
  }),
  inflow('every-3-weeks', {
    type: 'other',
    schedule: 'every_n_weeks',
    interval_count: 3,
    amount_cents: 333_33,
  }),
  inflow('joint-interest', {
    type: 'other',
    schedule: 'monthly',
    amount_cents: 210_00,
    is_joint: true,
    member_split_percent: 60,
  }),
  inflow('ended', {
    schedule: 'fortnightly',
    amount_cents: 1_500_00,
    starts_on: '2026-07-01',
    ends_on: '2026-09-14',
  }),
  inflow('redundancy', {
    schedule: null,
    amount_cents: 80_000_00,
    paid_on: '2026-11-20',
    one_off_tax_treatment: 'genuine_redundancy',
    years_of_service: 12,
  }),
  inflow('gift', {
    taxable: false,
    member_id: null,
    type: 'gift',
    schedule: null,
    amount_cents: 500_00,
    paid_on: '2026-12-25',
  }),
]

const expectedFortnightly = {
  items: inflows.map((row) => ({
    inflowId: row.id,
    fortnightlyCents:
      row.paid_on != null ? null : fortnightlyCents(annualGrossCents(toIncomeInput(row)), 'annual'),
  })),
}

const NOW = '2026-11-09T00:00:00Z'

interface Draft {
  isWage: boolean
  schedule: Frequency
  interval?: number
  amountCents?: number
  hourlyRateCents?: number
  hoursPerPeriod?: number
  payCadence: Frequency | null
  payInterval?: number
  oneOff?: {
    treatment: Tables<'inflows'>['one_off_tax_treatment'] & string
    amountCents: number
    yearsOfService?: number
    dateOfBirth: string | null
    paidOn: string
  }
}

/** What the form derives from `draft`, by the PWA's own functions. */
function previewOf(draft: Draft) {
  const entered = draft.isWage
    ? draft.hourlyRateCents !== undefined && draft.hoursPerPeriod !== undefined
    : draft.amountCents !== undefined
  const stated = entered
    ? annualInflowGrossCents({
        type: draft.isWage ? 'wage' : 'other',
        schedule: draft.schedule,
        ...(draft.interval !== undefined && { interval: draft.interval }),
        ...(draft.isWage
          ? {
              hourlyRateCents: draft.hourlyRateCents ?? 0,
              hoursPerPeriod: draft.hoursPerPeriod ?? 0,
            }
          : { amountCents: draft.amountCents ?? 0 }),
      })
    : null
  return {
    statedAnnualCents: stated,
    perPayment: describePerPayment(
      stated,
      draft.schedule,
      draft.interval,
      draft.payCadence,
      draft.payInterval,
    ),
    split: draft.oneOff
      ? previewOneOffSplit(
          {
            ...EMPTY_ONE_OFF_DRAFT,
            paidOn: draft.oneOff.paidOn,
            treatment: draft.oneOff.treatment,
            yearsOfService: draft.oneOff.yearsOfService ?? '',
          },
          true,
          draft.oneOff.amountCents,
          draft.oneOff.dateOfBirth,
          FY2027_CONFIG,
        )
      : null,
  }
}

const drafts: Draft[] = [
  { isWage: false, schedule: 'annual', amountCents: 120_000_00, payCadence: 'fortnightly' },
  { isWage: false, schedule: 'annual', amountCents: 100_001_00, payCadence: 'monthly' },
  { isWage: false, schedule: 'fortnightly', amountCents: 3_000_00, payCadence: null },
  {
    isWage: true,
    schedule: 'weekly',
    hourlyRateCents: 45_50,
    hoursPerPeriod: 37.5,
    payCadence: 'every_n_weeks',
    payInterval: 2,
  },
  { isWage: false, schedule: 'every_n_months', interval: 5, amountCents: 777_77, payCadence: null },
  { isWage: false, schedule: 'annual', payCadence: null },
  {
    isWage: false,
    schedule: 'fortnightly',
    amountCents: 80_000_00,
    payCadence: null,
    oneOff: {
      treatment: 'genuine_redundancy',
      amountCents: 80_000_00,
      yearsOfService: 12,
      dateOfBirth: '1970-05-01',
      paidOn: '2026-11-20',
    },
  },
  {
    isWage: false,
    schedule: 'fortnightly',
    amountCents: 90_000_00,
    payCadence: null,
    oneOff: {
      treatment: 'employment_termination',
      amountCents: 90_000_00,
      dateOfBirth: null,
      paidOn: '2026-11-20',
    },
  },
]

const cases = drafts.map((draft) => ({
  input: { now: NOW, ...draft },
  expected: previewOf(draft),
}))

describe('the native Inflows parity fixture', () => {
  const text = `${JSON.stringify(
    [
      {
        name: 'seven inflows and eight drafts',
        rows: { inflows },
        expectedFortnightly,
        drafts: cases,
      },
    ],
    null,
    2,
  )}\n`

  it('matches what the PWA Inflows screen and form compute from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises a one-off, a joint inflow, a wage and a rounding gap', () => {
    expect(expectedFortnightly.items.filter((item) => item.fortnightlyCents === null)).toHaveLength(
      2,
    )
    expect(cases[1]?.expected.perPayment).not.toBeNull()
    expect(cases[6]?.expected.split?.taxFreeCents).toBeGreaterThan(0)
  })
})
