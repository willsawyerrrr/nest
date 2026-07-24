import { afterEach, describe, expect, it } from 'vitest'
import {
  AGES_STORAGE_KEY,
  ASSUMPTIONS_STORAGE_KEY,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PROJECTION_HORIZON_OPTION,
  PROJECTION_HORIZON_STORAGE_KEY,
  readAssumptions,
  readMemberAges,
  readProjectionHorizon,
  setMemberAge,
  toProjectionInput,
  writeAssumptions,
  writeProjectionHorizon,
  yearsToRetirement,
} from './retirement'

afterEach(() => localStorage.clear())

describe('readAssumptions / writeAssumptions', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readAssumptions()).toEqual(DEFAULT_ASSUMPTIONS)
  })

  it('round-trips written assumptions', () => {
    const assumptions = {
      retirementAge: 65,
      expectedReturnPct: 6,
      inflationPct: 3,
      contributionGrowthPct: 2,
    }
    writeAssumptions(assumptions)
    expect(readAssumptions()).toEqual(assumptions)
  })

  it('fills missing or invalid fields from the defaults', () => {
    localStorage.setItem(
      ASSUMPTIONS_STORAGE_KEY,
      JSON.stringify({ expectedReturnPct: 8, inflationPct: 'nope' }),
    )
    expect(readAssumptions()).toEqual({
      ...DEFAULT_ASSUMPTIONS,
      expectedReturnPct: 8,
    })
  })

  it('falls back to the defaults on unparseable storage', () => {
    localStorage.setItem(ASSUMPTIONS_STORAGE_KEY, '{not json')
    expect(readAssumptions()).toEqual(DEFAULT_ASSUMPTIONS)
  })
})

describe('member ages', () => {
  it('starts empty and persists a set age', () => {
    expect(readMemberAges()).toEqual({})
    const next = setMemberAge({}, 'm1', 40)
    expect(next).toEqual({ m1: 40 })
    expect(readMemberAges()).toEqual({ m1: 40 })
  })

  it('removes an age when set to null and does not mutate the input', () => {
    const ages = { m1: 40, m2: 50 }
    const next = setMemberAge(ages, 'm1', null)
    expect(next).toEqual({ m2: 50 })
    expect(ages).toEqual({ m1: 40, m2: 50 })
    expect(readMemberAges()).toEqual({ m2: 50 })
  })

  it('ignores non-finite stored ages', () => {
    localStorage.setItem(AGES_STORAGE_KEY, JSON.stringify({ m1: 40, m2: 'x' }))
    expect(readMemberAges()).toEqual({ m1: 40 })
  })

  it('returns an empty map on unparseable storage', () => {
    localStorage.setItem(AGES_STORAGE_KEY, '{not json')
    expect(readMemberAges()).toEqual({})
  })
})

describe('projection horizon', () => {
  it('defaults to "to retirement" when nothing is stored', () => {
    expect(readProjectionHorizon()).toBe(DEFAULT_PROJECTION_HORIZON_OPTION)
    expect(DEFAULT_PROJECTION_HORIZON_OPTION).toBe('retirement')
  })

  it('round-trips a written horizon option', () => {
    writeProjectionHorizon('10y')
    expect(readProjectionHorizon()).toBe('10y')
  })

  it('falls back to the default for an unrecognised stored value', () => {
    localStorage.setItem(PROJECTION_HORIZON_STORAGE_KEY, '99y')
    expect(readProjectionHorizon()).toBe(DEFAULT_PROJECTION_HORIZON_OPTION)
  })
})

describe('yearsToRetirement', () => {
  it('is the whole-year gap, never negative', () => {
    expect(yearsToRetirement(30, 60)).toBe(30)
    expect(yearsToRetirement(65, 60)).toBe(0)
    expect(yearsToRetirement(59.6, 60)).toBe(0)
  })
})

describe('toProjectionInput', () => {
  it('converts percentages to rates and ages to a year count', () => {
    expect(
      toProjectionInput(100_000_00, 20_000_00, 35, {
        retirementAge: 60,
        expectedReturnPct: 7,
        inflationPct: 2.5,
        contributionGrowthPct: 3,
      }),
    ).toEqual({
      currentBalanceCents: 100_000_00,
      annualContributionCents: 20_000_00,
      years: 25,
      nominalReturnRate: 0.07,
      inflationRate: 0.025,
      contributionGrowthRate: 0.03,
    })
  })
})
