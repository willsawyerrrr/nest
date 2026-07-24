import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useGifts } from './useGifts'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useGifts', () => {
  it('loads every gift collection and runs each mutation with its cross-reloads', async () => {
    const { result } = renderHook(() => useGifts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.recipients).toEqual([])
    expect(result.current.occasions).toEqual([])
    expect(result.current.budgets).toEqual([])
    expect(result.current.purchases).toEqual([])

    await act(async () => {
      await result.current.reload()
      await result.current.createRecipient({ name: 'Mum', member_id: null })
      await result.current.updateRecipient('r1', { name: 'Mum', member_id: null })
      await result.current.removeRecipient('r1')
      await result.current.createOccasion({ name: 'Birthday', occasion_date: null })
      await result.current.updateOccasion('o1', { name: 'Birthday', occasion_date: null })
      await result.current.removeOccasion('o1')
      await result.current.createBudget({
        recipient_id: 'r1',
        occasion_id: 'o1',
        budgeted_amount_cents: 100,
        event_date: null,
      })
      await result.current.updateBudget('gb1', {
        recipient_id: 'r1',
        occasion_id: 'o1',
        budgeted_amount_cents: 100,
        event_date: null,
      })
      await result.current.removeBudget('gb1')
      await result.current.createPurchase({
        gift_budget_id: 'gb1',
        amount_cents: 50,
        description: 'x',
        purchased_on: '2027-01-01',
      })
      await result.current.updatePurchase('gp1', {
        gift_budget_id: 'gb1',
        amount_cents: 50,
        description: 'x',
        purchased_on: '2027-01-01',
      })
      await result.current.removePurchase('gp1')
    })
  })

  it('reports loading while any collection is null', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useGifts('h1'), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })
})
