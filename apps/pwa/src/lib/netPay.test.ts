import { describe, expect, it } from 'vitest'
import { makePayslip } from '../test/fixtures'
import { netPayCorroboration, salaryCreditBounds, toSalaryCreditCandidate } from './netPay'

const row = {
  id: 't1',
  posted_at: '2026-07-15T21:00:00+10:00',
  amount_cents: 4_000_00,
  member_id: null,
  description: 'Acme',
  transaction_type: 'Direct Credit',
}

describe('salaryCreditBounds', () => {
  it('runs from the day before the year to eight days past it', () => {
    const { from, to } = salaryCreditBounds(2027)
    expect(new Date(from).getTime()).toBe(new Date('2026-06-30T00:00:00').getTime())
    expect(new Date(to).getTime()).toBe(new Date('2027-07-08T00:00:00').getTime())
  })
})

describe('toSalaryCreditCandidate', () => {
  it('reads the credit on its local date', () => {
    expect(toSalaryCreditCandidate(row)).toEqual({
      id: 't1',
      postedOn: '2026-07-15',
      amountCents: 4_000_00,
      memberId: null,
      payer: 'Acme',
      transactionType: 'Direct Credit',
    })
  })
})

describe('netPayCorroboration', () => {
  it('measures the credit against the slip and the plan’s net from its variance', () => {
    const result = netPayCorroboration(
      2027,
      ['m1'],
      [makePayslip()],
      new Map([
        ['ps1', { expectedGrossCents: 5_000_00, expectedTaxWithheldCents: 900_00 } as never],
      ]),
      [row],
    )
    expect(result.byPayslip.get('ps1')).toMatchObject({
      status: 'matched',
      creditId: 't1',
      modelledDifferenceCents: -100_00,
    })
  })

  it('models no net for a slip with no variance', () => {
    const result = netPayCorroboration(2027, ['m1'], [makePayslip()], new Map(), [row])
    expect(result.byPayslip.get('ps1')!.modelledDifferenceCents).toBeNull()
  })
})
