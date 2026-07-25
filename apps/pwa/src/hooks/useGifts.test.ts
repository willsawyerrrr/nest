import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useGifts } from './useGifts'

const { builder, from } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order'])
  return { builder, from: vi.fn((_table: string) => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

const tables = ['gift_recipient', 'gift_occasion', 'gift_budget', 'gift_purchase'] as const
type GiftTable = (typeof tables)[number]

/** How many times a table was accessed — one per load, plus one per write. */
const accesses = (table: GiftTable): number =>
  from.mock.calls.filter((call) => call[0] === table).length

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useGifts', () => {
  it('loads every gift collection and reloads them together', async () => {
    const { result } = renderHook(() => useGifts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.recipients).toEqual([])
    expect(result.current.occasions).toEqual([])
    expect(result.current.budgets).toEqual([])
    expect(result.current.purchases).toEqual([])

    const before = Object.fromEntries(tables.map((t) => [t, accesses(t)])) as Record<
      GiftTable,
      number
    >
    await act(() => result.current.reload())
    for (const table of tables) {
      expect(accesses(table)).toBeGreaterThan(before[table])
    }
  })

  it('refreshes only the mutated table when creating or updating', async () => {
    const { result } = renderHook(() => useGifts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    /** Which sibling tables a mutation reloads, keyed by table. */
    async function siblingReloads(run: () => Promise<void>): Promise<Record<GiftTable, number>> {
      const before = Object.fromEntries(tables.map((t) => [t, accesses(t)])) as Record<
        GiftTable,
        number
      >
      await act(run)
      return Object.fromEntries(tables.map((t) => [t, accesses(t) - before[t]])) as Record<
        GiftTable,
        number
      >
    }

    const recipientInput = { name: 'Mum', member_id: null }
    const occasionInput = { name: 'Birthday', occasion_date: null }
    const budgetInput = {
      recipient_id: 'r1',
      occasion_id: 'o1',
      budgeted_amount_cents: 100,
      event_date: null,
    }
    const purchaseInput = {
      gift_budget_id: 'gb1',
      amount_cents: 50,
      description: 'x',
      purchased_on: '2027-01-01',
    }

    // Creating a row inserts and reloads only its own table; sibling rows are
    // unchanged, so their queries stay put.
    expect(
      await siblingReloads(() => result.current.createRecipient(recipientInput)),
    ).toMatchObject({ gift_occasion: 0, gift_budget: 0, gift_purchase: 0 })
    expect(await siblingReloads(() => result.current.createOccasion(occasionInput))).toMatchObject({
      gift_recipient: 0,
      gift_budget: 0,
      gift_purchase: 0,
    })
    expect(await siblingReloads(() => result.current.createBudget(budgetInput))).toMatchObject({
      gift_recipient: 0,
      gift_occasion: 0,
      gift_purchase: 0,
    })
    expect(await siblingReloads(() => result.current.createPurchase(purchaseInput))).toMatchObject({
      gift_recipient: 0,
      gift_occasion: 0,
      gift_budget: 0,
    })

    // Updating a row likewise touches no sibling.
    expect(
      await siblingReloads(() => result.current.updateRecipient('r1', recipientInput)),
    ).toMatchObject({ gift_occasion: 0, gift_budget: 0, gift_purchase: 0 })
    expect(
      await siblingReloads(() => result.current.updateOccasion('o1', occasionInput)),
    ).toMatchObject({ gift_recipient: 0, gift_budget: 0, gift_purchase: 0 })
    expect(
      await siblingReloads(() => result.current.updateBudget('gb1', budgetInput)),
    ).toMatchObject({ gift_recipient: 0, gift_occasion: 0, gift_purchase: 0 })
    expect(
      await siblingReloads(() => result.current.updatePurchase('gp1', purchaseInput)),
    ).toMatchObject({ gift_recipient: 0, gift_occasion: 0, gift_budget: 0 })
  })

  it('reloads the tables a delete cascade reaches, and no others', async () => {
    const { result } = renderHook(() => useGifts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    async function siblingReloads(run: () => Promise<void>): Promise<Record<GiftTable, number>> {
      const before = Object.fromEntries(tables.map((t) => [t, accesses(t)])) as Record<
        GiftTable,
        number
      >
      await act(run)
      return Object.fromEntries(tables.map((t) => [t, accesses(t) - before[t]])) as Record<
        GiftTable,
        number
      >
    }

    // Deleting a recipient cascades to its budgets and their purchases, but not
    // to occasions, so only budgets and purchases reload alongside recipients.
    const afterRecipient = await siblingReloads(() => result.current.removeRecipient('r1'))
    expect(afterRecipient.gift_occasion).toBe(0)
    expect(afterRecipient.gift_budget).toBeGreaterThan(0)
    expect(afterRecipient.gift_purchase).toBeGreaterThan(0)

    // Deleting an occasion cascades the same way, sparing recipients.
    const afterOccasion = await siblingReloads(() => result.current.removeOccasion('o1'))
    expect(afterOccasion.gift_recipient).toBe(0)
    expect(afterOccasion.gift_budget).toBeGreaterThan(0)
    expect(afterOccasion.gift_purchase).toBeGreaterThan(0)

    // Deleting a budget cascades only to its purchases.
    const afterBudget = await siblingReloads(() => result.current.removeBudget('gb1'))
    expect(afterBudget.gift_recipient).toBe(0)
    expect(afterBudget.gift_occasion).toBe(0)
    expect(afterBudget.gift_purchase).toBeGreaterThan(0)

    // A purchase is a leaf; deleting one cascades to nothing.
    const afterPurchase = await siblingReloads(() => result.current.removePurchase('gp1'))
    expect(afterPurchase.gift_recipient).toBe(0)
    expect(afterPurchase.gift_occasion).toBe(0)
    expect(afterPurchase.gift_budget).toBe(0)
  })

  it('reports loading while any collection is null', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useGifts('h1'), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })

  it('invalidates the budget_line cache on a gift-budget or gift-recipient write', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useGifts('h1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // A gift-budget write drives the reconcile trigger, rewriting the derived gift
    // lines the Pay splits tab reads, so budget_line is invalidated.
    invalidateSpy.mockClear()
    await act(() => result.current.removeBudget('gb1'))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budget_line', 'h1'] })

    // A gift-recipient write does the same (an external recipient's partition).
    invalidateSpy.mockClear()
    await act(() => result.current.createRecipient({ name: 'Mum', member_id: null }))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budget_line', 'h1'] })
  })
})
