import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { makeSupabaseBuilder, type SupabaseBuilder } from '../test/supabaseBuilder'
import { useCategoryGroups } from './useCategoryGroups'

const { builders, from } = vi.hoisted(() => ({
  builders: {} as Record<string, SupabaseBuilder>,
  from: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

beforeEach(() => {
  vi.clearAllMocks()
  for (const table of ['up_category', 'up_category_default_group', 'up_category_group']) {
    builders[table] = makeSupabaseBuilder(['select', 'upsert', 'delete', 'eq'])
  }
  builders.up_category!.result = {
    data: [
      { id: 'good-life', name: 'Good Life', parent_id: null },
      { id: 'home', name: 'Home', parent_id: null },
      { id: 'groceries', name: 'Groceries', parent_id: 'good-life' },
      { id: 'booze', name: 'Booze', parent_id: 'good-life' },
      { id: 'utilities', name: 'Utilities', parent_id: 'home' },
      { id: 'orphan', name: 'Orphan', parent_id: 'gone' },
    ],
    error: null,
  }
  builders.up_category_default_group!.result = {
    data: [
      { category_id: 'groceries', line_group: 'needs' },
      { category_id: 'booze', line_group: 'discretionary' },
    ],
    error: null,
  }
  builders.up_category_group!.result = {
    data: [
      { category_id: 'booze', line_group: 'wants' },
      { category_id: 'utilities', line_group: null },
    ],
    error: null,
  }
  from.mockImplementation((table: string) => builders[table])
})

describe('useCategoryGroups', () => {
  it('lists every child category with its default and override, by parent then name', async () => {
    const { result } = renderHook(() => useCategoryGroups(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.categories).not.toBeNull())

    expect(result.current.categories).toEqual([
      { id: 'orphan', name: 'Orphan', parentName: '', defaultGroup: null, override: undefined },
      {
        id: 'booze',
        name: 'Booze',
        parentName: 'Good Life',
        defaultGroup: 'discretionary',
        override: 'wants',
      },
      {
        id: 'groceries',
        name: 'Groceries',
        parentName: 'Good Life',
        defaultGroup: 'needs',
        override: undefined,
      },
      {
        id: 'utilities',
        name: 'Utilities',
        parentName: 'Home',
        defaultGroup: null,
        override: null,
      },
    ])
  })

  it.each(['up_category', 'up_category_default_group', 'up_category_group'])(
    'stays unresolved when the %s read fails',
    async (table) => {
      builders[table]!.result = { data: null, error: new Error('denied') }
      const { result } = renderHook(() => useCategoryGroups(), { wrapper: makeWrapper() })
      await waitFor(() => expect(from).toHaveBeenCalledWith('up_category_group'))
      expect(result.current.categories).toBeNull()
    },
  )

  it('upserts an override, including to no group', async () => {
    const { result } = renderHook(() => useCategoryGroups(), { wrapper: makeWrapper() })
    await act(() => result.current.setGroup('groceries', null))
    expect(builders.up_category_group!.upsert).toHaveBeenCalledWith(
      { household_id: 'h1', category_id: 'groceries', line_group: null },
      { onConflict: 'household_id,category_id' },
    )
  })

  it('throws a failed upsert', async () => {
    const { result } = renderHook(() => useCategoryGroups(), { wrapper: makeWrapper() })
    builders.up_category_group!.result = { data: null, error: new Error('denied') }
    await expect(result.current.setGroup('groceries', 'wants')).rejects.toThrow('denied')
  })

  it('deletes the override to restore the default', async () => {
    const { result } = renderHook(() => useCategoryGroups(), { wrapper: makeWrapper() })
    await act(() => result.current.resetGroup('booze'))
    expect(builders.up_category_group!.delete).toHaveBeenCalled()
    expect(builders.up_category_group!.eq).toHaveBeenCalledWith('household_id', 'h1')
    expect(builders.up_category_group!.eq).toHaveBeenCalledWith('category_id', 'booze')
  })

  it('throws a failed delete', async () => {
    const { result } = renderHook(() => useCategoryGroups(), { wrapper: makeWrapper() })
    builders.up_category_group!.result = { data: null, error: new Error('denied') }
    await expect(result.current.resetGroup('booze')).rejects.toThrow('denied')
  })
})
