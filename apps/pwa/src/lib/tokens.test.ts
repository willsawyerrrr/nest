import { describe, expect, it } from 'vitest'
import { budgetGroupChartOrder, chartColors, chartPalette, semanticColors } from './tokens'

describe('semanticColors', () => {
  it('names the non-brand semantic tokens', () => {
    expect(semanticColors).toEqual({
      brand: 'brand',
      positive: 'positive',
      negative: 'negative',
      warning: 'warning',
      info: 'info',
    })
  })
})

describe('chartColors', () => {
  it('covers the six budget groups plus buffer, tax, and sacrifice', () => {
    expect(Object.keys(chartColors)).toEqual([
      'needs',
      'wants',
      'discretionary',
      'temporary',
      'savings',
      'investments',
      'buffer',
      'tax',
      'sacrifice',
    ])
  })

  it('refers to theme colours by CSS variable', () => {
    expect(chartColors.needs).toBe('var(--mantine-color-brand-5)')
  })
})

describe('chartPalette', () => {
  it('is the budget groups in plot order', () => {
    expect(chartPalette).toEqual(budgetGroupChartOrder.map((key) => chartColors[key]))
    expect(chartPalette).toHaveLength(6)
  })
})
