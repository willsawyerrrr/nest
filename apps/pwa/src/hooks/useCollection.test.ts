import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHouseholdCollection, useHouseholdUpsertCollection } from './useCollection'

const { builder, fromMock } = vi.hoisted(() => {
  const b: Record<string, unknown> & { result: { data: unknown; error: unknown } } = {
    result: { data: [], error: null },
  } as never
  for (const method of [
    'select',
    'insert',
    'upsert',
    'update',
    'delete',
    'eq',
    'order',
    'single',
  ]) {
    b[method] = vi.fn(() => b)
  }
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(b.result).then(onFulfilled, onRejected)
  return { builder: b, fromMock: vi.fn(() => b) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: fromMock } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useHouseholdCollection', () => {
  it('loads rows applying match filters and ordered columns', async () => {
    builder.result = { data: [{ id: '1' }], error: null }
    const { result } = renderHook(
      () =>
        useHouseholdCollection('h1', {
          table: 'inflows',
          orderBy: ['name', 'type'],
          match: { member_id: 'm1' },
        }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.rows).toEqual([{ id: '1' }]))
    expect(fromMock).toHaveBeenCalledWith('inflows')
    expect(builder.select).toHaveBeenCalledWith('*')
    expect(builder.eq).toHaveBeenCalledWith('member_id', 'm1')
    expect(builder.order).toHaveBeenCalledWith('name')
    expect(builder.order).toHaveBeenCalledWith('type')
  })

  it('creates, updates, removes, and reloads', async () => {
    const { result } = renderHook(
      () =>
        useHouseholdCollection('h1', {
          table: 'inflows',
          orderBy: 'name',
          insertDefaults: { source: 'manual' },
        }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create({ name: 'x' } as never)
    })
    expect(builder.insert).toHaveBeenCalledWith({ name: 'x', source: 'manual', household_id: 'h1' })

    await act(async () => {
      await result.current.update('id1', { name: 'y' } as never)
    })
    expect(builder.update).toHaveBeenCalledWith({ name: 'y' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'id1')

    await act(async () => {
      await result.current.remove('id2')
    })
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'id2')

    await act(async () => {
      await result.current.reload()
    })
  })

  it('invalidates every same-table query on the table+household prefix', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    // A scoped detail query and the unscoped roll-up of the same table, as the
    // breakdown-item and breakdown hooks mount them side by side.
    const { result } = renderHook(
      () => ({
        scoped: useHouseholdCollection('h1', {
          table: 'breakdown_item',
          orderBy: 'name',
          match: { breakdown_id: 'bd1' },
          insertDefaults: { breakdown_id: 'bd1' },
        }),
        unscoped: useHouseholdCollection('h1', { table: 'breakdown_item', orderBy: 'name' }),
      }),
      { wrapper },
    )
    await waitFor(() => {
      expect(result.current.scoped.loading).toBe(false)
      expect(result.current.unscoped.loading).toBe(false)
    })

    invalidateSpy.mockClear()
    const unscopedKey = ['breakdown_item', 'h1', '{}', 'name']
    const before = client.getQueryState(unscopedKey)?.dataUpdatedAt ?? 0
    await act(async () => {
      await result.current.scoped.create({ name: 'x' } as never)
    })

    // A mutation on the scoped query invalidates by the [table, householdId]
    // prefix, so the unscoped roll-up refetches too — not only the scoped key.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['breakdown_item', 'h1'] })
    await waitFor(() =>
      expect(client.getQueryState(unscopedKey)?.dataUpdatedAt ?? 0).toBeGreaterThan(before),
    )
  })

  it('loads without an order or match', async () => {
    const { result } = renderHook(() => useHouseholdCollection('h1', { table: 'inflows' }), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toEqual([])
  })

  it('surfaces a load error', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useHouseholdCollection('h1', { table: 'inflows' }), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toBeNull()
  })

  it('propagates create, update, and remove errors', async () => {
    const { result } = renderHook(() => useHouseholdCollection('h1', { table: 'inflows' }), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('write failed') }
    await expect(result.current.create({} as never)).rejects.toThrow('write failed')
    await expect(result.current.update('i', {} as never)).rejects.toThrow('write failed')
    await expect(result.current.remove('i')).rejects.toThrow('write failed')
  })
})

describe('useHouseholdUpsertCollection', () => {
  it('upserts with the conflict target and reloads', async () => {
    const { result } = renderHook(
      () =>
        useHouseholdUpsertCollection('h1', {
          table: 'tax_profile',
          match: { financial_year: 2027 },
          insertDefaults: { financial_year: 2027 },
          onConflict: 'member_id,financial_year',
        }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.upsert({ member_id: 'm1' } as never)
    })
    expect(builder.upsert).toHaveBeenCalledWith(
      { member_id: 'm1', financial_year: 2027, household_id: 'h1' },
      { onConflict: 'member_id,financial_year' },
    )

    await act(async () => {
      await result.current.reload()
    })
  })

  it('propagates an upsert error', async () => {
    const { result } = renderHook(
      () => useHouseholdUpsertCollection('h1', { table: 'tax_profile', onConflict: 'x' }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('upsert failed') }
    await expect(result.current.upsert({} as never)).rejects.toThrow('upsert failed')
  })
})
