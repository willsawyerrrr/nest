import { describe, expect, it } from 'vitest'
import {
  NET_WORTH_SERIES_COLORS,
  projectionTooltipItems,
  type NetWorthProjectionRow,
} from './netWorthChart'

function row(overrides: Partial<NetWorthProjectionRow> = {}): NetWorthProjectionRow {
  return {
    year: 'FY2027',
    super: 0,
    cash: 0,
    equity: 0,
    help: 0,
    debt: 0,
    total: 0,
    ...overrides,
  }
}

describe('projectionTooltipItems', () => {
  it('lists each asset positive and each liability negative, in order', () => {
    const items = projectionTooltipItems(
      row({ super: 100_00, cash: 50_00, equity: 30_00, help: 20_00, debt: 10_00 }),
    )
    expect(items).toEqual([
      { label: 'Super', color: NET_WORTH_SERIES_COLORS.super, cents: 100_00 },
      { label: 'Cash & other', color: NET_WORTH_SERIES_COLORS.cash, cents: 50_00 },
      { label: 'Equity', color: NET_WORTH_SERIES_COLORS.equity, cents: 30_00 },
      { label: 'HELP debt', color: NET_WORTH_SERIES_COLORS.help, cents: -20_00 },
      { label: 'Debt accounts', color: NET_WORTH_SERIES_COLORS.debt, cents: -10_00 },
    ])
  })

  it('omits every component that is not positive', () => {
    expect(projectionTooltipItems(row())).toEqual([])
  })
})
