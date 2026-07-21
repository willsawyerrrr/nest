import { describe, expect, it } from 'vitest'
import { formatFrequency, FREQUENCY_OPTIONS } from './frequency'

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

  it('interpolates the interval for every_n_months', () => {
    expect(formatFrequency('every_n_months', 3)).toBe('Every 3 months')
  })

  it('renders a single-month interval as "Every month"', () => {
    expect(formatFrequency('every_n_months', 1)).toBe('Every month')
  })

  it('falls back to "Every N months" when the interval is missing', () => {
    expect(formatFrequency('every_n_months')).toBe('Every N months')
    expect(formatFrequency('every_n_months', null)).toBe('Every N months')
  })
})

describe('FREQUENCY_OPTIONS', () => {
  it('includes the every_n_weeks and every_n_months cadences', () => {
    expect(FREQUENCY_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'every_n_weeks', label: 'Every N weeks' },
        { value: 'every_n_months', label: 'Every N months' },
      ]),
    )
  })
})
