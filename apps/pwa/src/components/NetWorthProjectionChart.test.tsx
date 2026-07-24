import { describe, expect, it } from 'vitest'
import { projectionTooltipItems } from '../lib/netWorthChart'
import { render, screen } from '../test/render'
import { ProjectionTooltip } from './NetWorthProjectionChart'

const row = {
  year: '2030',
  super: 200_000_00,
  cash: 30_000_00,
  equity: 5_000_00,
  help: 20_000_00,
  debt: 1_500_00,
  total: 213_500_00,
}

describe('projectionTooltipItems', () => {
  it('lists assets as positive and liabilities as negative amounts', () => {
    expect(projectionTooltipItems(row)).toEqual([
      { label: 'Super', color: expect.any(String), cents: 200_000_00 },
      { label: 'Cash & other', color: expect.any(String), cents: 30_000_00 },
      { label: 'Equity', color: expect.any(String), cents: 5_000_00 },
      { label: 'HELP debt', color: expect.any(String), cents: -20_000_00 },
      { label: 'Debt accounts', color: expect.any(String), cents: -1_500_00 },
    ])
  })

  it('omits components that are zero', () => {
    const labels = projectionTooltipItems({
      year: '2030',
      super: 100_00,
      cash: 0,
      equity: 0,
      help: 0,
      debt: 800_00,
      total: -700_00,
    }).map((item) => item.label)
    expect(labels).toEqual(['Super', 'Debt accounts'])
  })
})

describe('ProjectionTooltip', () => {
  it('itemises assets, liabilities, and the net-worth total when active', () => {
    render(<ProjectionTooltip active payload={[{ payload: row }]} />)

    expect(screen.getByText('2030')).toBeInTheDocument()
    expect(screen.getByText('Super')).toBeInTheDocument()
    expect(screen.getByText('HELP debt')).toBeInTheDocument()
    expect(screen.getByText('Debt accounts')).toBeInTheDocument()
    // Liabilities read as negative amounts.
    expect(screen.getByText('-$20,000.00')).toBeInTheDocument()
    expect(screen.getByText('-$1,500.00')).toBeInTheDocument()
    // The net-worth total is the assets less the liabilities.
    expect(screen.getByText('Net worth')).toBeInTheDocument()
    expect(screen.getByText('$213,500.00')).toBeInTheDocument()
  })

  it('renders nothing when inactive or without a row', () => {
    render(<ProjectionTooltip active={false} payload={[{ payload: row }]} />)
    expect(screen.queryByRole('dialog', { name: 'Projection breakdown' })).not.toBeInTheDocument()
  })
})
