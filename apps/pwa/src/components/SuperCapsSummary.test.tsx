import { describe, expect, it } from 'vitest'
import type { SuperCapSummary } from '../lib/tax'
import { render, screen } from '../test/render'
import { SuperCapsSummary } from './SuperCapsSummary'

const base: SuperCapSummary = {
  concessionalCents: 10_000_00,
  concessionalCapCents: 30_000_00,
  concessionalOverCap: false,
  nonConcessionalCents: 20_000_00,
  nonConcessionalCapCents: 120_000_00,
  nonConcessionalOverCap: false,
  coContributionCents: 0,
}

describe('SuperCapsSummary', () => {
  it('shows concessional and non-concessional usage against their caps', () => {
    render(<SuperCapsSummary summary={base} />)

    // Concessional and non-concessional usage each show their amount used.
    expect(screen.getByText('$10,000.00')).toBeInTheDocument()
    expect(screen.getByText('$20,000.00')).toBeInTheDocument()
    expect(screen.getByText(/bring-forward may allow/i)).toBeInTheDocument()
    // No alerts when under both caps and with no co-contribution.
    expect(screen.queryByText(/over the concessional cap/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/co-contribution/i)).not.toBeInTheDocument()
  })

  it('warns when either cap is exceeded', () => {
    render(
      <SuperCapsSummary
        summary={{ ...base, concessionalOverCap: true, nonConcessionalOverCap: true }}
      />,
    )

    expect(screen.getByText(/over the concessional cap/i)).toBeInTheDocument()
    expect(screen.getByText(/over the non-concessional cap/i)).toBeInTheDocument()
  })

  it('shows the estimated government co-contribution when it applies', () => {
    render(<SuperCapsSummary summary={{ ...base, coContributionCents: 500_00 }} />)

    expect(screen.getByText(/estimated government co-contribution \$500\.00/i)).toBeInTheDocument()
  })
})
