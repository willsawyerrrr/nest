import { describe, expect, it } from 'vitest'
import type { EquityExerciseRow } from '../hooks/useEquityExercises'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import type { EquitySaleRow } from '../hooks/useEquitySales'
import { exerciseError, saleError } from './equity'

const grant = { id: 'g1', instrument_type: 'option', quantity: 100 } as EquityGrantRow
const exercise = { id: 'e1', grant_id: 'g1', quantity: 40 } as EquityExerciseRow
const sale = { id: 's1', grant_id: 'g1', quantity: 30 } as EquitySaleRow

describe('exerciseError', () => {
  it('refuses more options than are left to exercise', () => {
    expect(exerciseError(grant, [exercise], [], 61)).toBe('Only 60 options are left to exercise.')
  })

  it('refuses an edit that drops exercised options below those sold', () => {
    expect(exerciseError(grant, [exercise], [sale], 10, 'e1')).toBe(
      'Exercised options cannot fall below the shares already sold.',
    )
  })

  it('accepts a quantity within the limits', () => {
    expect(exerciseError(grant, [exercise], [sale], 60)).toBeNull()
  })
})

describe('saleError', () => {
  it('refuses more shares than are left to sell', () => {
    expect(saleError(grant, [exercise], [sale], 11)).toBe('Only 10 shares are left to sell.')
  })

  it('accepts a quantity within the limit, ignoring the sale being edited', () => {
    expect(saleError(grant, [exercise], [sale], 40, 's1')).toBeNull()
  })
})
