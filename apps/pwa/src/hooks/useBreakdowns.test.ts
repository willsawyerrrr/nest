import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useBreakdowns, type BreakdownInput, type BreakdownUpdate } from './useBreakdowns'

const { builder, from } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order'])
  return { builder, from: vi.fn((_table: string) => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

const createInput: BreakdownInput = { name: 'Meds', line_group: 'needs', kind: 'generic' }
const updateInput: BreakdownUpdate = { name: 'Vitamins', line_group: 'wants' }

/** How many times a table was accessed — one per load, plus one per write. */
const accesses = (table: string): number =>
  from.mock.calls.filter((call) => call[0] === table).length

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useBreakdowns', () => {
  it('loads breakdowns alongside items and reloads them together', async () => {
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.breakdowns).toEqual([])
    expect(result.current.items).toEqual([])

    const beforeBreakdown = accesses('breakdown')
    const beforeItem = accesses('breakdown_item')
    await act(() => result.current.reload())
    expect(accesses('breakdown')).toBeGreaterThan(beforeBreakdown)
    expect(accesses('breakdown_item')).toBeGreaterThan(beforeItem)
  })

  it('leaves items untouched when creating or updating, and reloads them on delete', async () => {
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Creating a breakdown adds no items, so the items query stays put.
    let beforeItem = accesses('breakdown_item')
    await act(() => result.current.create(createInput))
    expect(builder.insert).toHaveBeenCalledWith({ ...createInput, household_id: 'h1' })
    expect(accesses('breakdown_item')).toBe(beforeItem)

    // Updating a breakdown's name and group changes no item either.
    beforeItem = accesses('breakdown_item')
    await act(() => result.current.update('bd1', updateInput))
    expect(builder.update).toHaveBeenCalledWith(updateInput)
    expect(accesses('breakdown_item')).toBe(beforeItem)

    // Deleting a breakdown cascades to its items, so the items query reloads.
    beforeItem = accesses('breakdown_item')
    await act(() => result.current.remove('bd1'))
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'bd1')
    expect(accesses('breakdown_item')).toBeGreaterThan(beforeItem)
  })

  it('reports loading while a collection is null', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })

  it('invalidates the budget_line cache on a breakdown write', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // A breakdown's name and group flow onto its derived line via the trigger, so
    // the raw budget lines are invalidated for the Pay splits tab.
    invalidateSpy.mockClear()
    await act(() => result.current.update('bd1', updateInput))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budget_line', 'h1'] })
  })
})
