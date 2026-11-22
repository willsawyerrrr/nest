import { describe, expect, it } from 'vitest'
import { makeAccount, makeMember } from '../test/fixtures'
import {
  ACCOUNT_TYPE_ORDER,
  accountOwnerLabel,
  accountTypeLabel,
  groupAccountsByType,
  ledgerSourceLabel,
} from './accounts'

describe('accountTypeLabel', () => {
  it('labels every account type', () => {
    expect(ACCOUNT_TYPE_ORDER.map(accountTypeLabel)).toEqual([
      'Spending',
      'Savings',
      'Offset',
      'Credit',
      'Home loan',
      'Other',
    ])
  })
})

describe('ledgerSourceLabel', () => {
  it('labels every source', () => {
    expect(ledgerSourceLabel('up')).toBe('Up')
    expect(ledgerSourceLabel('redbark')).toBe('Redbark')
    expect(ledgerSourceLabel('manual')).toBe('Manual')
  })
})

describe('accountOwnerLabel', () => {
  const members = [makeMember({ id: 'm1', name: 'Alex' })]

  it('names a joint account Joint', () => {
    expect(accountOwnerLabel(makeAccount({ owner_member_id: null }), members)).toBe('Joint')
  })

  it("names an individual account's owner", () => {
    expect(accountOwnerLabel(makeAccount({ owner_member_id: 'm1' }), members)).toBe('Alex')
  })
})

describe('groupAccountsByType', () => {
  it('groups in type order, keeps incoming order, omits empty types and sums balances', () => {
    const loan = makeAccount({ id: 'l', type: 'home_loan', balance_cents: -400_000_00 })
    const saverB = makeAccount({ id: 'b', type: 'savings', balance_cents: 2_000_00 })
    const saverA = makeAccount({ id: 'a', type: 'savings', balance_cents: 500_00 })
    const spending = makeAccount({ id: 's', type: 'transaction', balance_cents: 120_00 })

    const groups = groupAccountsByType([loan, saverB, saverA, spending])

    expect(groups.map((group) => [group.label, group.accounts.map((a) => a.id)])).toEqual([
      ['Spending', ['s']],
      ['Savings', ['b', 'a']],
      ['Home loan', ['l']],
    ])
    expect(groups.map((group) => group.totalCents)).toEqual([120_00, 2_500_00, -400_000_00])
  })

  it('counts an account excluded from net worth in its group total', () => {
    const groups = groupAccountsByType([
      makeAccount({ balance_cents: 1_00 }),
      makeAccount({ id: 'a2', balance_cents: 2_00, exclude_from_net_worth: true }),
    ])
    expect(groups[0]?.totalCents).toBe(3_00)
  })

  it('returns no groups for no accounts', () => {
    expect(groupAccountsByType([])).toEqual([])
  })
})
