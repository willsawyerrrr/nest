import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaxBreakdown } from '@nest/tax'
import { planningStorageKey } from '../lib/planningMode'
import { render, screen } from '../test/render'
import { PlanningModeProvider } from './PlanningModeProvider'
import { WithholdingPosition } from './WithholdingPosition'

afterEach(() => localStorage.clear())

const base: TaxBreakdown = {
  taxableIncomeCents: 0,
  incomeForSurchargeCents: 0,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
  oneOffOffsetCents: 0,
  medicareLevyCents: 0,
  medicareLevySurchargeCents: 0,
  helpRepaymentCents: 0,
  division293Cents: 0,
  totalLiabilityCents: 1_000_000,
  paygWithheldCents: 1_200_000,
  balanceCents: -200_000,
  repaymentIncomeCents: 0,
}

function withPlanning(ui: ReactNode) {
  localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
  return render(<PlanningModeProvider>{ui}</PlanningModeProvider>)
}

describe('WithholdingPosition', () => {
  it('reads the plain refund with no baseline', () => {
    render(<WithholdingPosition breakdown={base} />)
    expect(screen.getByText(/refund/)).toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('shows the balance move when the direction is unchanged', () => {
    const baseline: TaxBreakdown = { ...base, balanceCents: -500_000 }
    withPlanning(<WithholdingPosition breakdown={base} baseline={baseline} />)
    // still a refund: $5,000.00 → $2,000.00
    expect(screen.getByText('$5,000.00')).toBeInTheDocument()
    expect(screen.getByText('$2,000.00')).toBeInTheDocument()
    expect(screen.getByText(/refund/)).toBeInTheDocument()
  })

  it('shows just the new figure when the direction flips from a bill to a refund', () => {
    const baseline: TaxBreakdown = { ...base, balanceCents: 300_000 }
    withPlanning(<WithholdingPosition breakdown={base} baseline={baseline} />)
    // A flipped direction: no "was → now", just the proposed $2,000.00 refund.
    expect(screen.getByText('$2,000.00')).toBeInTheDocument()
    expect(screen.getByText(/refund/)).toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('names no refund or bill when the estimate is met exactly', () => {
    render(<WithholdingPosition breakdown={{ ...base, balanceCents: 0 }} />)
    expect(screen.getByText('Tracking toward no refund or bill.')).toBeInTheDocument()
  })
})
