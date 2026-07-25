import { describe, expect, it } from 'vitest'
import {
  budgetGroupChartOrder,
  chartColorName,
  chartColors,
  chartPalette,
  netWorthColorName,
  netWorthColors,
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

describe('netWorthColors', () => {
  it('covers each net-worth key', () => {
    expect(Object.keys(netWorthColors)).toEqual([
      'superannuation',
      'cash',
      'equity',
      'liability',
      'debtAccount',
      'excluded',
      'total',
    ])
  })

  it('resolves each key to a scheme-aware light-dark pair', () => {
    expect(netWorthColors.equity).toBe(
      'light-dark(var(--mantine-color-violet-6), var(--mantine-color-violet-5))',
    )
    expect(netWorthColors.liability).toBe(
      'light-dark(var(--mantine-color-negative-6), var(--mantine-color-negative-6))',
    )
  })

  it('mirrors the matching categorical chart hues', () => {
    // Chart bands source the same hues the budget-group palette uses, so nothing
    // shifts visually when the net-worth section re-sources through its own keys.
    expect(netWorthColors.superannuation).toBe(chartColors.savings)
    expect(netWorthColors.cash).toBe(chartColors.needs)
    expect(netWorthColors.equity).toBe(chartColors.wants)
    expect(netWorthColors.liability).toBe(chartColors.tax)
    expect(netWorthColors.debtAccount).toBe(chartColors.temporary)
    expect(netWorthColors.total).toBe(chartColors.sacrifice)
  })
})

describe('netWorthColorName', () => {
  it('names the Mantine base colour for each net-worth key', () => {
    expect(netWorthColorName).toEqual({
      superannuation: 'teal',
      cash: 'indigo',
      equity: 'violet',
      liability: 'negative',
      debtAccount: 'orange',
      excluded: 'gray',
      total: 'brand',
    })
  })

  it('gives the equity glyph the same hue as its chart band', () => {
    expect(netWorthColorName.equity).toBe('violet')
  })
})
