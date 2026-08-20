import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import {
  EMPTY_ONE_OFF_DRAFT,
  isOneOffDraftComplete,
  oneOffDraftFrom,
  oneOffRecurrenceInput,
  previewOneOffSplit,
  RECURRING_RECURRENCE_INPUT,
  type OneOffDraft,
} from './oneOffInflow'

const config = FY2027_CONFIG

function draft(overrides: Partial<OneOffDraft> = {}): OneOffDraft {
  return { ...EMPTY_ONE_OFF_DRAFT, paidOn: '2026-09-12', ...overrides }
}

describe('oneOffDraftFrom', () => {
  it('reads a saved one-off’s own fields', () => {
    expect(
      oneOffDraftFrom({
        paid_on: '2026-09-12',
        one_off_tax_treatment: 'genuine_redundancy',
        years_of_service: 12,
      }),
    ).toEqual({ paidOn: '2026-09-12', treatment: 'genuine_redundancy', yearsOfService: 12 })
  })

  it('opens empty on a recurring inflow, which stores none of them', () => {
    expect(
      oneOffDraftFrom({ paid_on: null, one_off_tax_treatment: null, years_of_service: null }),
    ).toEqual(EMPTY_ONE_OFF_DRAFT)
  })
})

describe('isOneOffDraftComplete', () => {
  it('needs the date the money lands on', () => {
    expect(isOneOffDraftComplete(EMPTY_ONE_OFF_DRAFT, true)).toBe(false)
    expect(isOneOffDraftComplete(draft(), true)).toBe(true)
  })

  it('needs completed years of service for a genuine redundancy alone', () => {
    const redundancy = draft({ treatment: 'genuine_redundancy' })
    expect(isOneOffDraftComplete(redundancy, true)).toBe(false)
    expect(isOneOffDraftComplete({ ...redundancy, yearsOfService: 0 }, true)).toBe(true)
    // A non-taxable payment carries no treatment at all, so it asks for nothing more.
    expect(isOneOffDraftComplete(redundancy, false)).toBe(true)
  })
})

describe('oneOffRecurrenceInput', () => {
  it('writes the date, the treatment, and the redundancy’s years of service', () => {
    expect(
      oneOffRecurrenceInput(draft({ treatment: 'genuine_redundancy', yearsOfService: 12 }), true),
    ).toEqual({
      paid_on: '2026-09-12',
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 12,
    })
  })

  it('leaves years of service unset under every other treatment', () => {
    expect(oneOffRecurrenceInput(draft({ treatment: 'unused_leave' }), true)).toEqual({
      paid_on: '2026-09-12',
      one_off_tax_treatment: 'unused_leave',
      years_of_service: null,
    })
  })

  it('gives a non-taxable one-off neither a treatment nor years of service', () => {
    expect(
      oneOffRecurrenceInput(draft({ treatment: 'genuine_redundancy', yearsOfService: 12 }), false),
    ).toEqual({ paid_on: '2026-09-12', one_off_tax_treatment: null, years_of_service: null })
  })

  it('writes nothing at all for a recurring inflow', () => {
    expect(RECURRING_RECURRENCE_INPUT).toEqual({
      paid_on: null,
      one_off_tax_treatment: null,
      years_of_service: null,
    })
  })
})

describe('previewOneOffSplit', () => {
  it('splits a genuine redundancy into its tax-free and assessable parts', () => {
    const split = previewOneOffSplit(
      draft({ treatment: 'genuine_redundancy', yearsOfService: 10 }),
      true,
      100_000_00,
      null,
      config,
    )
    // $13,598 base plus $6,801 for each of 10 completed years.
    expect(split).toEqual({
      taxFreeCents: 13_598_00 + 10 * 6_801_00,
      assessableCents: 100_000_00 - (13_598_00 + 10 * 6_801_00),
      concessionalCents: 100_000_00 - (13_598_00 + 10 * 6_801_00),
      concessionalRate: config.employmentTermination.belowPreservationAgeRate,
    })
  })

  it('takes the lower rate for a member already at preservation age', () => {
    expect(
      previewOneOffSplit(
        draft({ treatment: 'employment_termination' }),
        true,
        50_000_00,
        '1960-01-01',
        config,
      )?.concessionalRate,
    ).toBe(config.employmentTermination.atPreservationAgeRate)
  })

  it('has nothing to split for a non-taxable payment, or before the amount or date is given', () => {
    expect(previewOneOffSplit(draft(), false, 50_000_00, null, config)).toBeNull()
    expect(previewOneOffSplit(draft(), true, null, null, config)).toBeNull()
    expect(previewOneOffSplit(EMPTY_ONE_OFF_DRAFT, true, 50_000_00, null, config)).toBeNull()
  })
})
