import { describe, expect, it } from 'vitest'
import {
  budgetGroupChartOrder,
  chartColorName,
  chartColors,
  chartPalette,
  semanticColors,
} from './tokens'

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

  it('resolves each hue to a scheme-aware light-dark pair', () => {
    expect(chartColors.needs).toBe(
      'light-dark(var(--mantine-color-indigo-6), var(--mantine-color-indigo-5))',
    )
    expect(chartColors.tax).toBe(
      'light-dark(var(--mantine-color-negative-6), var(--mantine-color-negative-6))',
    )
  })

  it('spans distinct hues across the six budget groups', () => {
    expect(budgetGroupChartOrder.map((key) => chartColorName[key])).toEqual([
      'indigo',
      'violet',
      'pink',
      'orange',
      'teal',
      'cyan',
    ])
  })
})

describe('chartColorName', () => {
  it('names the Mantine base colour for each categorical key', () => {
    expect(chartColorName).toEqual({
      needs: 'indigo',
      wants: 'violet',
      discretionary: 'pink',
      temporary: 'orange',
      savings: 'teal',
      investments: 'cyan',
      buffer: 'gray',
      tax: 'negative',
      sacrifice: 'brand',
    })
  })
})

describe('chartPalette', () => {
  it('is the budget groups in plot order', () => {
    expect(chartPalette).toEqual(budgetGroupChartOrder.map((key) => chartColors[key]))
    expect(chartPalette).toHaveLength(6)
  })
})
