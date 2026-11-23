import { describe, expect, it } from 'vitest'
import { makeMember } from '../test/fixtures'
import {
  categoryFilterOptions,
  hasTransactionFilters,
  parseTransactionFilters,
  transactionAttribution,
  transactionFilterParams,
  UNCATEGORISED,
} from './transactionList'

const ACCOUNT = '11111111-2222-3333-4444-555555555555'

describe('parseTransactionFilters', () => {
  it('reads every filter from the search params', () => {
    const params = new URLSearchParams(
      `account=${ACCOUNT}&from=2026-07-01&to=2026-07-31&kind=expense&status=pending&category=groceries`,
    )
    expect(parseTransactionFilters(params)).toEqual({
      account: ACCOUNT,
      from: '2026-07-01',
      to: '2026-07-31',
      kind: 'expense',
      status: 'pending',
      category: 'groceries',
    })
  })

  it('ignores malformed values', () => {
    const params = new URLSearchParams(
      'account=nope&from=July&to=2026-7-1&kind=gift&status=done&category=a,b.eq.c',
    )
    expect(hasTransactionFilters(parseTransactionFilters(params))).toBe(false)
  })
})

describe('transactionFilterParams', () => {
  it('round-trips, omitting unfiltered dimensions', () => {
    const filters = parseTransactionFilters(new URLSearchParams('kind=transfer&category=none'))
    expect(transactionFilterParams(filters).toString()).toBe('kind=transfer&category=none')
  })
})

describe('transactionAttribution', () => {
  const members = [makeMember({ id: 'm1', name: 'Will' })]

  it("names an individual account's owner", () => {
    expect(
      transactionAttribution(members, { member_id: 'm1', performing_customer_name: null }),
    ).toBe('Will')
  })

  it('reads Joint for a joint account, naming the partner Up records', () => {
    expect(
      transactionAttribution(members, { member_id: null, performing_customer_name: null }),
    ).toBe('Joint')
    expect(
      transactionAttribution(members, { member_id: null, performing_customer_name: '$alex' }),
    ).toBe('Joint · $alex')
  })
})

describe('categoryFilterOptions', () => {
  it('leads with Uncategorised, then each parent and its children alphabetically', () => {
    expect(
      categoryFilterOptions([
        { id: 'home', name: 'Home', parent_id: null },
        { id: 'good-life', name: 'Good Life', parent_id: null },
        { id: 'restaurants-and-cafes', name: 'Restaurants & Cafes', parent_id: 'good-life' },
        { id: 'booze', name: 'Booze', parent_id: 'good-life' },
      ]),
    ).toEqual([
      { value: UNCATEGORISED, label: 'Uncategorised' },
      {
        group: 'Good Life',
        items: [
          { value: 'good-life', label: 'All Good Life' },
          { value: 'booze', label: 'Booze' },
          { value: 'restaurants-and-cafes', label: 'Restaurants & Cafes' },
        ],
      },
      { group: 'Home', items: [{ value: 'home', label: 'All Home' }] },
    ])
  })
})
