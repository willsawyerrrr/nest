import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useBreakdownItems } from './useBreakdownItems'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'x' }], error: null }
})

describe('useBreakdownItems', () => {
  it('exposes one breakdown’s items and its mutations', async () => {
    const { result } = renderHook(() => useBreakdownItems('h1', 'bd1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'x' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create({} as never)
      await result.current.update('x', {} as never)
      await result.current.remove('x')
      await result.current.reload()
    })
    expect(builder.eq).toHaveBeenCalledWith('breakdown_id', 'bd1')
  })
})
