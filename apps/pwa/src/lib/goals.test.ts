import { describe, expect, it } from 'vitest'
import { assumedInterestNote, interestBpsToPercent, interestPercentToBps } from './goals'

describe('interestBpsToPercent', () => {
  it('renders basis points as a percent', () => {
    expect(interestBpsToPercent(450)).toBe(4.5)
  })

  it('is blank when no rate is set', () => {
    expect(interestBpsToPercent(null)).toBe('')
    expect(interestBpsToPercent(undefined)).toBe('')
  })
})

describe('interestPercentToBps', () => {
  it('rounds a percent to whole basis points', () => {
    expect(interestPercentToBps(4.5)).toBe(450)
    expect(interestPercentToBps('3.755')).toBe(376)
  })

  it('is null when blank', () => {
    expect(interestPercentToBps('')).toBeNull()
    expect(interestPercentToBps(null as unknown as string)).toBeNull()
  })

  it('is null when not a finite number', () => {
    expect(interestPercentToBps('abc')).toBeNull()
  })
})

describe('assumedInterestNote', () => {
  it('states the rate to two decimal places', () => {
    expect(assumedInterestNote(450)).toBe('4.50% p.a. assumed')
  })

  it('is null when no interest is modelled', () => {
    expect(assumedInterestNote(null)).toBeNull()
    expect(assumedInterestNote(0)).toBeNull()
  })
})
