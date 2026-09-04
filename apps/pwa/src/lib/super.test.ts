import { describe, expect, it } from 'vitest'
import type { Account } from '../hooks/useAccounts'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import {
  accountsWithEffectiveSuperBalances,
  homeLoanLiabilities,
  homeLoanOwedCents,
  netWorthBreakdown,
  superAccountIds,
  superAccountName,
} from './super'

function account(
  id: string,
  balanceCents: number,
  excludeFromNetWorth = false,
  type: Account['type'] = 'savings',
): Account {
  return {
    id,
    name: id,
    balance_cents: balanceCents,
    household_id: 'h1',
    currency: 'AUD',
    exclude_from_net_worth: excludeFromNetWorth,
    deleted_from_source_at: null,
    external_id: null,
    owner_member_id: null,
    source: 'manual',
    type,
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

  it('accrues nothing for a super account whose member has no modelled contribution', () => {
    const accounts = [account('super1', 10_000_00)]
    const profiles = [
      profile({ member_id: 'm1', linked_account_id: 'super1', balance_as_of: '2025-07-20' }),
    ]
    // The member is absent from the net-contribution map, so their accrual is
    // zero and the balance stays at the baseline despite a year-old as-of date.
    const result = accountsWithEffectiveSuperBalances(accounts, profiles, new Map(), today)
    expect(result[0]!.balance_cents).toBe(10_000_00)
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

  it('turns a home-loan account into a named liability ahead of the passed ones', () => {
    const accounts = [
      account('cash', 10_000_00, false, 'transaction'),
      // Up reports the balance owing as a negative number.
      account('mortgage', -450_000_00, false, 'home_loan'),
    ]
    const breakdown = netWorthBreakdown(accounts, new Set(), [
      { label: 'Will HELP debt', balanceCents: 20_000_00 },
    ])

    expect(breakdown.otherAccounts.map((a) => a.id)).toEqual(['cash'])
    expect(breakdown.liabilities).toEqual([
      { label: 'mortgage', balanceCents: 450_000_00 },
      { label: 'Will HELP debt', balanceCents: 20_000_00 },
    ])
    expect(breakdown.liabilitiesTotalCents).toBe(470_000_00)
    // cash 10_000 − mortgage 450_000 − HELP 20_000 = −460_000.
    expect(breakdown.totalCents).toBe(-460_000_00)
  })

  it('leaves an excluded home loan out of the liabilities and off the total', () => {
    const accounts = [
      account('cash', 10_000_00, false, 'transaction'),
      account('mortgage', -450_000_00, true, 'home_loan'),
    ]
    const breakdown = netWorthBreakdown(accounts, new Set())

    expect(breakdown.liabilities).toEqual([])
    expect(breakdown.excludedAccounts.map((a) => a.id)).toEqual(['mortgage'])
    expect(breakdown.totalCents).toBe(10_000_00)
  })

  it('adds vested equity as an asset and subtracts liabilities in the total', () => {
    const accounts = [account('a1', 100000), account('a2', 50000)]
    const breakdown = netWorthBreakdown(
      accounts,
      new Set(['a1']),
      [{ label: 'Will HELP debt', balanceCents: 20000 }],
      [
        { label: 'Will — options', valueCents: 30000 },
        { label: 'Sam — shares', valueCents: 10000 },
      ],
    )

    expect(breakdown.equityHoldings.map((h) => h.label)).toEqual(['Will — options', 'Sam — shares'])
    expect(breakdown.equityTotalCents).toBe(40000)
    expect(breakdown.liabilitiesTotalCents).toBe(20000)
    // super 100000 + other 50000 + equity 40000 − liabilities 20000 = 170000.
    expect(breakdown.totalCents).toBe(170000)
  })
})

describe('homeLoanOwedCents', () => {
  it('is the magnitude of the balance, whichever sign Up sends', () => {
    expect(homeLoanOwedCents({ balance_cents: -450_000_00 })).toBe(450_000_00)
    expect(homeLoanOwedCents({ balance_cents: 450_000_00 })).toBe(450_000_00)
  })
})

describe('homeLoanLiabilities', () => {
  it('maps each included home-loan account to a named amount owed', () => {
    const accounts = [
      account('cash', 10_000_00, false, 'transaction'),
      account('mortgage', -450_000_00, false, 'home_loan'),
      account('old-mortgage', -1_00, true, 'home_loan'),
    ]
    expect(homeLoanLiabilities(accounts)).toEqual([{ label: 'mortgage', balanceCents: 450_000_00 }])
  })
})
