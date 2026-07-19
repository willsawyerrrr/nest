import { describe, expect, it } from 'vitest'
import { formatFrequency } from './frequency'

describe('formatFrequency', () => {
  it('interpolates the interval for every_n_weeks', () => {
    expect(formatFrequency('every_n_weeks', 4)).toBe('Every 4 weeks')
  })

  it('renders a single-week interval as "Every week"', () => {
    expect(formatFrequency('every_n_weeks', 1)).toBe('Every week')
  })

  it('capitalises a fixed frequency', () => {
    expect(formatFrequency('fortnightly')).toBe('Fortnightly')
  })

  it('labels biannual as "Biannually"', () => {
    expect(formatFrequency('biannual')).toBe('Biannually')
  })

  it('labels annual as "Annually"', () => {
    expect(formatFrequency('annual')).toBe('Annually')
  })

  it('falls back to "Every N weeks" when the interval is missing', () => {
    expect(formatFrequency('every_n_weeks')).toBe('Every N weeks')
    expect(formatFrequency('every_n_weeks', null)).toBe('Every N weeks')
  })
})
