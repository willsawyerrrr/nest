import { describe, expect, it } from 'vitest'
import type { Account } from '../hooks/useAccounts'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import { netWorthBreakdown, superAccountIds, superAccountName } from './super'

function account(id: string, balanceCents: number): Account {
  return {
    id,
    name: id,
    balance_cents: balanceCents,
    household_id: 'h1',
    currency: 'AUD',
    external_id: null,
    owner_member_id: null,
    source: 'manual',
    type: 'savings',
    created_at: '',
    updated_at: '',
  }
}

function profile(overrides: Partial<SuperProfile>): SuperProfile {
  return {
    id: 'p1',
    household_id: 'h1',
    member_id: 'm1',
    financial_year: 2027,
    fund_name: null,
    sg_rate_override: null,
    linked_account_id: null,
    carry_forward_cap_cents: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('superAccountName', () => {
  it('uses the trimmed fund name when given', () => {
    expect(superAccountName('  AustralianSuper  ', 'Will')).toBe('AustralianSuper')
  })

  it('falls back to "<member> Super" when the fund name is blank or null', () => {
    expect(superAccountName('   ', 'Will')).toBe('Will Super')
    expect(superAccountName(null, 'Partner')).toBe('Partner Super')
  })
})

describe('superAccountIds', () => {
  it('collects the non-null linked account ids', () => {
    const ids = superAccountIds([
      profile({ linked_account_id: 'a1' }),
      profile({ linked_account_id: null }),
      profile({ linked_account_id: 'a2' }),
    ])
    expect(ids).toEqual(new Set(['a1', 'a2']))
  })
})

describe('netWorthBreakdown', () => {
  it('splits accounts into super and other with subtotals and a total', () => {
    const accounts = [account('a1', 100000), account('a2', 50000), account('a3', 25000)]
    const breakdown = netWorthBreakdown(accounts, new Set(['a1', 'a2']))

    expect(breakdown.superAccounts.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(breakdown.otherAccounts.map((a) => a.id)).toEqual(['a3'])
    expect(breakdown.superTotalCents).toBe(150000)
    expect(breakdown.otherTotalCents).toBe(25000)
    expect(breakdown.totalCents).toBe(175000)
  })
})
