import { describe, expect, it } from 'vitest'
import type { Account } from '../hooks/useAccounts'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import {
  accountsWithEffectiveSuperBalances,
  accruedBalanceCents,
  netWorthBreakdown,
  superAccountIds,
  superAccountName,
} from './super'

function account(id: string, balanceCents: number, excludeFromNetWorth = false): Account {
  return {
    id,
    name: id,
    balance_cents: balanceCents,
    household_id: 'h1',
    currency: 'AUD',
    exclude_from_net_worth: excludeFromNetWorth,
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
    balance_as_of: null,
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

describe('accruedBalanceCents', () => {
  const today = new Date('2026-07-20T00:00:00Z')

  it('returns the baseline unchanged when the as-of date is null', () => {
    expect(accruedBalanceCents(10_000_00, null, 12_000_00, today)).toBe(10_000_00)
  })

  it('accrues a proportional share of the annual contribution for a mid-year as-of', () => {
    // 2026-04-11 is 100 days before today; at $365/yr (100c/day) → $100 accrued.
    expect(accruedBalanceCents(10_000_00, '2026-04-11', 365_00, today)).toBe(10_100_00)
  })

  it('leaves the baseline unchanged when the net contribution is zero', () => {
    expect(accruedBalanceCents(10_000_00, '2025-07-20', 0, today)).toBe(10_000_00)
  })

  it('accrues a full year of contributions across a full year', () => {
    expect(accruedBalanceCents(10_000_00, '2025-07-20', 12_000_00, today)).toBe(22_000_00)
  })

  it('clamps a future as-of date to zero accrual', () => {
    expect(accruedBalanceCents(10_000_00, '2027-07-20', 12_000_00, today)).toBe(10_000_00)
  })
})

describe('accountsWithEffectiveSuperBalances', () => {
  const today = new Date('2026-07-20T00:00:00Z')

  it('replaces super account balances with their effective value and leaves others alone', () => {
    const accounts = [
      account('super1', 10_000_00),
      account('super2', 20_000_00),
      account('other', 5_000_00),
    ]
    const profiles = [
      profile({ member_id: 'm1', linked_account_id: 'super1', balance_as_of: '2025-07-20' }),
      profile({ member_id: 'm2', linked_account_id: 'super2', balance_as_of: null }),
    ]
    const net = new Map([
      ['m1', 12_000_00],
      ['m2', 9_000_00],
    ])

    const result = accountsWithEffectiveSuperBalances(accounts, profiles, net, today)

    // super1 accrues a full year; super2 has no as-of date; other is untouched.
    expect(result.find((a) => a.id === 'super1')?.balance_cents).toBe(22_000_00)
    expect(result.find((a) => a.id === 'super2')?.balance_cents).toBe(20_000_00)
    expect(result.find((a) => a.id === 'other')?.balance_cents).toBe(5_000_00)
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
    expect(breakdown.excludedAccounts).toEqual([])
    expect(breakdown.totalCents).toBe(175000)
  })

  it('collects excluded accounts separately and leaves them out of every total', () => {
    const accounts = [account('a1', 100000), account('a2', 50000, true), account('a3', 25000, true)]
    const breakdown = netWorthBreakdown(accounts, new Set(['a1', 'a2']))

    expect(breakdown.superAccounts.map((a) => a.id)).toEqual(['a1'])
    expect(breakdown.otherAccounts).toEqual([])
    expect(breakdown.excludedAccounts.map((a) => a.id)).toEqual(['a2', 'a3'])
    expect(breakdown.superTotalCents).toBe(100000)
    expect(breakdown.otherTotalCents).toBe(0)
    expect(breakdown.totalCents).toBe(100000)
  })
})
