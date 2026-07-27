import { describe, expect, it } from 'vitest'
import {
  makeGiftPurchase,
  makeGiftTransaction,
  makeGiftTransactionDismissal,
} from '../test/fixtures'
import { dismissedGiftCandidates, giftCandidates, linkableGiftBudgets } from './giftCandidates'
import type { GiftBudget, GiftOccasion, GiftRecipient } from './gifts'

const bookshop = makeGiftTransaction({ id: 't1', description: 'Bookshop', amount_cents: -45_00 })
const florist = makeGiftTransaction({
  id: 't2',
  description: 'Florist',
  amount_cents: -12_50,
  posted_at: '2026-11-22T02:30:00+00:00',
})

describe('giftCandidates', () => {
  it('presents a transaction as a candidate with its amount as a magnitude', () => {
    expect(giftCandidates([bookshop], [], [])).toEqual([
      {
        transactionId: 't1',
        description: 'Bookshop',
        amountCents: 45_00,
        postedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        pending: false,
      },
    ])
  })

  it('dates a candidate by the local calendar day the transaction posted', () => {
    // Built from local noon, so the local date holds in every timezone.
    const posted = makeGiftTransaction({ posted_at: new Date(2026, 10, 20, 12).toISOString() })
    expect(giftCandidates([posted], [], [])[0]?.postedOn).toBe('2026-11-20')
  })

  it('flags a held transaction as pending', () => {
    const held = makeGiftTransaction({ status: 'pending' })
    expect(giftCandidates([held], [], [])[0]?.pending).toBe(true)
  })

  it('orders candidates newest first, tie-breaking on id', () => {
    const sameInstant = makeGiftTransaction({ id: 't0', posted_at: florist.posted_at })
    expect(
      giftCandidates([bookshop, sameInstant, florist], [], []).map(
        (candidate) => candidate.transactionId,
      ),
    ).toEqual(['t0', 't2', 't1'])
    // The same order holds whichever way round they arrive.
    expect(
      giftCandidates([florist, sameInstant, bookshop], [], []).map(
        (candidate) => candidate.transactionId,
      ),
    ).toEqual(['t0', 't2', 't1'])
  })

  it('drops a transaction a purchase already links to', () => {
    const purchases = [makeGiftPurchase({ transaction_id: 't1' })]
    expect(giftCandidates([bookshop, florist], purchases, []).map((c) => c.transactionId)).toEqual([
      't2',
    ])
  })

  it('keeps every candidate when the purchases are all hand-entered', () => {
    const purchases = [makeGiftPurchase({ transaction_id: null })]
    expect(giftCandidates([bookshop], purchases, [])).toHaveLength(1)
  })

  it('drops a transaction that was set aside', () => {
    const dismissals = [makeGiftTransactionDismissal({ transaction_id: 't2' })]
    expect(giftCandidates([bookshop, florist], [], dismissals).map((c) => c.transactionId)).toEqual(
      ['t1'],
    )
  })

  it('ignores a linked purchase whose transaction is not in the candidate set', () => {
    // The transaction aged out of the polled window, or sits on an account whose
    // balances the signed-in member cannot see. The purchase still stands; the
    // remaining candidates are unaffected.
    const purchases = [makeGiftPurchase({ transaction_id: 'gone' })]
    expect(giftCandidates([bookshop], purchases, []).map((c) => c.transactionId)).toEqual(['t1'])
  })
})

describe('dismissedGiftCandidates', () => {
  it('returns each set-aside candidate with the dismissal that undoes it, newest first', () => {
    const dismissals = [
      makeGiftTransactionDismissal({ id: 'd1', transaction_id: 't1' }),
      makeGiftTransactionDismissal({ id: 'd2', transaction_id: 't2' }),
    ]
    expect(
      dismissedGiftCandidates([bookshop, florist], dismissals).map((candidate) => [
        candidate.transactionId,
        candidate.dismissalId,
      ]),
    ).toEqual([
      ['t2', 'd2'],
      ['t1', 'd1'],
    ])
  })

  it('omits a dismissal whose transaction the member cannot see', () => {
    const dismissals = [makeGiftTransactionDismissal({ id: 'd9', transaction_id: 'private' })]
    expect(dismissedGiftCandidates([bookshop], dismissals)).toEqual([])
  })
})

function recipient(id: string, name: string, member_id: string | null = null): GiftRecipient {
  return { id, name, member_id, household_id: 'h', created_at: '', updated_at: '' }
}

function occasion(id: string, name: string): GiftOccasion {
  return { id, name, occasion_date: null, household_id: 'h', created_at: '', updated_at: '' }
}

function budget(id: string, recipient_id: string, occasion_id: string): GiftBudget {
  return {
    id,
    recipient_id,
    occasion_id,
    budgeted_amount_cents: 100_00,
    event_date: null,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

describe('linkableGiftBudgets', () => {
  const alice = recipient('r1', 'Alice')
  const me = recipient('r2', 'Me', 'm1')
  const xmas = occasion('o1', 'Christmas')
  const aliceXmas = budget('b1', 'r1', 'o1')
  const myXmas = budget('b2', 'r2', 'o1')

  it('labels each budget by recipient and occasion, ordered by label', () => {
    const zoe = recipient('r3', 'Zoe')
    const zoeXmas = budget('b3', 'r3', 'o1')
    expect(linkableGiftBudgets([zoeXmas, aliceXmas], [alice, zoe], [xmas], new Set())).toEqual([
      { value: 'b1', label: 'Alice — Christmas' },
      { value: 'b3', label: 'Zoe — Christmas' },
    ])
  })

  it('orders two identically labelled gifts by budget id', () => {
    // Two recipients can share a name, so the label alone is not a total order.
    const otherAlice = recipient('r4', 'Alice')
    const otherAliceXmas = budget('b0', 'r4', 'o1')
    expect(
      linkableGiftBudgets([aliceXmas, otherAliceXmas], [alice, otherAlice], [xmas], new Set()).map(
        (choice) => choice.value,
      ),
    ).toEqual(['b0', 'b1'])
  })

  it('excludes a gift whose spend is hidden from the signed-in member', () => {
    expect(linkableGiftBudgets([aliceXmas, myXmas], [alice, me], [xmas], new Set(['b2']))).toEqual([
      { value: 'b1', label: 'Alice — Christmas' },
    ])
  })

  it('skips a budget whose recipient or occasion is missing', () => {
    expect(linkableGiftBudgets([aliceXmas], [], [xmas], new Set())).toEqual([])
    expect(linkableGiftBudgets([aliceXmas], [alice], [], new Set())).toEqual([])
  })
})
