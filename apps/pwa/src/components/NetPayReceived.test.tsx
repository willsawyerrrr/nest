import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MemberNetPay, MemberSalaryCredit, SalaryCreditCandidate } from '@nest/plan'
import { render, screen } from '../test/render'
import { MemberNetPayBlock, UnattributedSalaryNote } from './NetPayReceived'

function salaryCredit(index: number, overrides: Partial<MemberSalaryCredit> = {}) {
  return {
    id: `c${index}`,
    postedOn: `2026-08-${String(index + 1).padStart(2, '0')}`,
    amountCents: 4_000_00,
    payer: 'Acme',
    payslipId: `s${index}`,
    daysSincePrevious: null,
    cadenceDrift: false,
    previousDifferenceCents: null,
    amountDrift: false,
    ...overrides,
  } satisfies MemberSalaryCredit
}

function netPay(credits: MemberSalaryCredit[]): MemberNetPay {
  return {
    memberId: 'm1',
    credits,
    receivedCents: credits.reduce((sum, credit) => sum + credit.amountCents, 0),
    payslipCount: 0,
    matchedCount: 0,
    cadenceDays: null,
  }
}

function candidate(id: string, payer: string): SalaryCreditCandidate {
  return {
    id,
    postedOn: '2026-07-15',
    amountCents: 4_000_00,
    memberId: null,
    payer,
    transactionType: 'Salary',
  }
}

describe('MemberNetPayBlock', () => {
  it('spells out a pay that differs from the previous one', () => {
    render(
      <MemberNetPayBlock
        netPay={netPay([
          salaryCredit(1, {
            amountCents: 4_500_00,
            previousDifferenceCents: 500_00,
            amountDrift: true,
          }),
          salaryCredit(0),
        ])}
      />,
    )
    expect(screen.getByText(/more than the previous pay/)).toHaveTextContent(
      '$500.00 more than the previous pay',
    )
  })

  it('folds credits past the first six behind Show all, and back again', async () => {
    const user = userEvent.setup()
    render(
      <MemberNetPayBlock
        netPay={netPay(Array.from({ length: 8 }, (_, index) => salaryCredit(index)))}
      />,
    )
    expect(screen.getAllByText('Acme', { exact: false })).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: 'Show all 8' }))
    expect(screen.getAllByText('Acme', { exact: false })).toHaveLength(8)

    await user.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByText('Acme', { exact: false })).toHaveLength(6)
  })
})

describe('UnattributedSalaryNote', () => {
  it('counts several credits and names each payer once', () => {
    render(
      <UnattributedSalaryNote
        credits={[candidate('a', 'QVS'), candidate('b', ' QVS '), candidate('c', 'Initech')]}
      />,
    )
    expect(screen.getByText(/3 salary credits from QVS, Initech/)).toBeInTheDocument()
  })
})
