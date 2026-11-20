import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext } from '../test/fakeContext.ts'
import { categoriseTransaction, listUpCategories } from './upCategories.ts'

const TX = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'

describe('listUpCategories', () => {
  it('nests each child under its parent, both sorted by name', async () => {
    const { ctx } = fakeContext({
      tables: {
        up_category: [
          { id: 'personal', name: 'Personal', parent_id: null },
          { id: 'good-life', name: 'Good Life', parent_id: null },
          { id: 'gifts-and-charity', name: 'Gifts & Charity', parent_id: 'personal' },
          { id: 'clothing', name: 'Clothing', parent_id: 'personal' },
          { id: 'restaurants', name: 'Restaurants', parent_id: 'good-life' },
        ],
      },
    })
    expect(await listUpCategories(ctx)).toEqual({
      categories: [
        {
          id: 'good-life',
          name: 'Good Life',
          children: [{ id: 'restaurants', name: 'Restaurants' }],
        },
        {
          id: 'personal',
          name: 'Personal',
          children: [
            { id: 'clothing', name: 'Clothing' },
            { id: 'gifts-and-charity', name: 'Gifts & Charity' },
          ],
        },
      ],
    })
  })
})

describe('categoriseTransaction', () => {
  it('invokes up-categorise and returns the recorded category', async () => {
    const { ctx, state } = fakeContext({
      invoke: {
        data: {
          transaction_id: TX,
          category_id: 'gifts-and-charity',
          parent_category_id: 'personal',
        },
      },
    })
    const result = await categoriseTransaction(ctx, {
      transaction_id: TX,
      category_id: 'gifts-and-charity',
    })
    expect(state.invocations).toEqual([
      { fn: 'up-categorise', body: { transaction_id: TX, category_id: 'gifts-and-charity' } },
    ])
    expect(result).toEqual({
      transaction_id: TX,
      category_id: 'gifts-and-charity',
      parent_category_id: 'personal',
    })
  })

  it('passes null through to clear the category', async () => {
    const { ctx, state } = fakeContext({
      invoke: { data: { transaction_id: TX, category_id: null, parent_category_id: null } },
    })
    await categoriseTransaction(ctx, { transaction_id: TX, category_id: null })
    expect(state.invocations[0]?.body).toEqual({ transaction_id: TX, category_id: null })
  })

  it('maps each function failure to a stable code without upstream text', async () => {
    const cases: [string, string][] = [
      ['transaction_not_found', 'not_found'],
      ['up_transaction_not_found', 'not_found'],
      ['not_up_transaction', 'not_categorisable'],
      ['not_categorisable', 'not_categorisable'],
      ['unknown_category', 'invalid_category'],
      ['parent_category', 'invalid_category'],
      ['up_not_connected', 'up_not_connected'],
      ['up_auth_failed', 'up_auth_failed'],
      ['up_rejected', 'up_rejected'],
      ['up_rate_limited', 'up_rate_limited'],
      ['save_failed', 'save_failed'],
      ['something_new', 'up_unavailable'],
    ]
    for (const [code, expected] of cases) {
      const { ctx } = fakeContext({
        invoke: { failure: { status: 422, body: { code, error: 'upstream detail' } } },
      })
      const error = await failure(
        categoriseTransaction(ctx, { transaction_id: TX, category_id: null }),
      )
      expect(error.code).toBe(expected)
      expect(error.message).not.toContain('upstream')
    }
  })

  it('maps a transport failure to up_unavailable', async () => {
    const { ctx } = fakeContext({ invoke: { failure: 'transport' } })
    const error = await failure(
      categoriseTransaction(ctx, { transaction_id: TX, category_id: null }),
    )
    expect(error.code).toBe('up_unavailable')
  })
})
