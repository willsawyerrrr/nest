import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import { atPreservationAgeOn, ENGINE_ONE_OFF_TREATMENTS } from '../tax.ts'

describe('atPreservationAgeOn', () => {
  it('reads an unknown date of birth as below preservation age — the higher rate', () => {
    expect(atPreservationAgeOn(null, '2026-09-12', FY2027_CONFIG)).toBe(false)
  })

  it('turns over on the birthday the member reaches preservation age', () => {
    expect(atPreservationAgeOn('1966-09-12', '2026-09-11', FY2027_CONFIG)).toBe(false)
    expect(atPreservationAgeOn('1966-09-12', '2026-09-12', FY2027_CONFIG)).toBe(true)
  })
})

describe('ENGINE_ONE_OFF_TREATMENTS', () => {
  it('names each stored treatment as the engine names it', () => {
    expect(ENGINE_ONE_OFF_TREATMENTS).toEqual({
      ordinary: 'ordinary',
      genuine_redundancy: 'genuineRedundancy',
      employment_termination: 'employmentTermination',
      unused_leave: 'unusedLeave',
    })
  })
})
