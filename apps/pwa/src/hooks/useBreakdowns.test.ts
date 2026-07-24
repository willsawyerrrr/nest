import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useBreakdowns, type BreakdownInput, type BreakdownUpdate } from './useBreakdowns'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const createInput: BreakdownInput = { name: 'Meds', line_group: 'needs', kind: 'generic' }
const updateInput: BreakdownUpdate = { name: 'Vitamins', line_group: 'wants' }

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useBreakdowns', () => {
  it('loads breakdowns alongside items and runs each mutation with an item reload', async () => {
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.breakdowns).toEqual([])
    expect(result.current.items).toEqual([])

    await act(async () => {
      await result.current.reload()
      await result.current.create(createInput)
      await result.current.update('bd1', updateInput)
      await result.current.remove('bd1')
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...createInput, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(updateInput)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'bd1')
  })

  it('reports loading while a collection is null', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })
})
