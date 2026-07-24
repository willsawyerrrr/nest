import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useHelpDebts } from './useHelpDebts'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'upsert', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'hd1', member_id: 'm1', balance_cents: 30_000_00 }], error: null }
})

describe('useHelpDebts', () => {
  it('exposes the household HELP debts and upserts one', async () => {
    const { result } = renderHook(() => useHelpDebts('h1'), { wrapper: makeWrapper() })
    await waitFor(() =>
      expect(result.current.helpDebts).toEqual([
        { id: 'hd1', member_id: 'm1', balance_cents: 30_000_00 },
      ]),
    )
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.upsert({ member_id: 'm1', balance_cents: 40_000_00 })
      await result.current.reload()
    })
    expect(builder.upsert).toHaveBeenCalled()
  })
})
