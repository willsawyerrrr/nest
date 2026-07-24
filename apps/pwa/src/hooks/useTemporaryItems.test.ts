import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTemporaryItem } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useTemporaryItems, type TemporaryItemInput } from './useTemporaryItems'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: TemporaryItemInput = {
  name: 'Holiday',
  contribution_cents: 120_00,
  target_date: '2027-08-03',
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeTemporaryItem()], error: null }
})

describe('useTemporaryItems', () => {
  it('exposes the household temporary items and its mutations', async () => {
    const { result } = renderHook(() => useTemporaryItems('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).toEqual([makeTemporaryItem()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('t1', input)
      await result.current.remove('t1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 't1')
  })
})
