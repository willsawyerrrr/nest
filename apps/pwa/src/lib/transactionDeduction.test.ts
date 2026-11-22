import { describe, expect, it } from 'vitest'
import {
  createDeductionPath,
  deductionDraftFromTransaction,
  isOutflow,
  transactionDescription,
  type SourceTransaction,
} from './transactionDeduction'

const transaction: SourceTransaction = {
  id: 't1',
  description: 'Bunnings',
  amount_cents: -120_50,
  posted_at: '2026-08-14T12:00:00+00:00',
}

describe('deductionDraftFromTransaction', () => {
  it('takes the description, absolute amount, date, and financial year', () => {
    expect(deductionDraftFromTransaction(transaction)).toEqual({
      transactionId: 't1',
      description: 'Bunnings',
      amountCents: 120_50,
      deductionDate: '2026-08-14',
      financialYear: 2027,
    })
  })

  it('files a June transaction in the year ending that June', () => {
    const draft = deductionDraftFromTransaction({
      ...transaction,
      posted_at: '2026-06-15T12:00:00+00:00',
    })
    expect(draft.financialYear).toBe(2026)
  })

  it('labels an unnamed transaction', () => {
    expect(deductionDraftFromTransaction({ ...transaction, description: '' }).description).toBe(
      'Card purchase',
    )
  })
})

describe('isOutflow', () => {
  it('is true only for a negative amount', () => {
    expect(isOutflow({ amount_cents: -1 })).toBe(true)
    expect(isOutflow({ amount_cents: 0 })).toBe(false)
    expect(isOutflow({ amount_cents: 5_00 })).toBe(false)
  })
})

describe('transactionDescription', () => {
  it('falls back for an empty description', () => {
    expect(transactionDescription({ description: '' })).toBe('Card purchase')
  })
})

describe('createDeductionPath', () => {
  it('names the transaction in the query', () => {
    expect(createDeductionPath('t1')).toBe('/deductions?transaction=t1')
  })
})
