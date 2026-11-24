import { describe, expect, it } from 'vitest'
import {
  categoryGroups,
  categoryLabel,
  isGift,
  reviewErrorMessage,
  reviewErrorNeedsConnections,
  transactionLabel,
  type UpCategory,
} from './transactionReview'

const categories: UpCategory[] = [
  { id: 'good-life', name: 'Good Life', parent_id: null },
  { id: 'home', name: 'Home', parent_id: null },
  { id: 'empty-parent', name: 'Empty', parent_id: null },
  { id: 'restaurants-and-cafes', name: 'Restaurants & Cafes', parent_id: 'good-life' },
  { id: 'gifts-and-charity', name: 'Gifts & Charity', parent_id: 'good-life' },
  { id: 'groceries', name: 'Groceries', parent_id: 'home' },
]

describe('categoryGroups', () => {
  it('groups child categories under their parents, alphabetically, dropping empty parents', () => {
    expect(categoryGroups(categories)).toEqual([
      {
        group: 'Good Life',
        items: [
          { value: 'gifts-and-charity', label: 'Gifts & Charity' },
          { value: 'restaurants-and-cafes', label: 'Restaurants & Cafes' },
        ],
      },
      { group: 'Home', items: [{ value: 'groceries', label: 'Groceries' }] },
    ])
  })
})

describe('categoryLabel', () => {
  it('reads parent then child', () => {
    expect(categoryLabel(categories, 'groceries')).toBe('Home › Groceries')
  })

  it('is null when uncategorised, and the id when unknown', () => {
    expect(categoryLabel(categories, null)).toBeNull()
    expect(categoryLabel(categories, 'mystery')).toBe('mystery')
  })

  it('reads the child alone when its parent is unknown', () => {
    expect(categoryLabel([{ id: 'c', name: 'Child', parent_id: 'gone' }], 'c')).toBe('Child')
  })
})

describe('isGift', () => {
  it('recognises the gift category', () => {
    expect(isGift({ external_category: 'gifts-and-charity' })).toBe(true)
    expect(isGift({ external_category: 'groceries' })).toBe(false)
  })
})

describe('transactionLabel', () => {
  it("uses the transaction's description, or a generic label when unnamed", () => {
    expect(transactionLabel({ description: 'Cafe Lune' })).toBe('Cafe Lune')
    expect(transactionLabel({ description: '' })).toBe('Card purchase')
  })
})

describe('reviewErrorMessage', () => {
  it('renders our own copy per code, with a fallback', () => {
    expect(reviewErrorMessage('up_rate_limited')).toBe(
      'Up is busy right now. Try again in a minute.',
    )
    expect(reviewErrorMessage('up_not_connected')).toBe(
      'Connect Up in Connections to change a category.',
    )
    expect(reviewErrorMessage('save_failed')).toBe(
      "Saved in Up, but Nest couldn't update its copy. Try again.",
    )
    expect(reviewErrorMessage('something_new')).toBe('Could not save this review. Try again.')
    expect(reviewErrorMessage(null)).toBe('Could not save this review. Try again.')
  })

  it('points the token failures at Connections', () => {
    expect(reviewErrorNeedsConnections('up_not_connected')).toBe(true)
    expect(reviewErrorNeedsConnections('up_auth_failed')).toBe(true)
    expect(reviewErrorNeedsConnections('up_rejected')).toBe(false)
    expect(reviewErrorNeedsConnections(null)).toBe(false)
  })
})
