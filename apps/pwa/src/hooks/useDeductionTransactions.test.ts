import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDeductedTransactionIds, useSourceTransactions } from './useDeductionTransactions'

const { builder, from } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'not', 'in'])
  return { builder, from: vi.fn((_table: string) => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useDeductedTransactionIds', () => {
  it('collects the transaction ids deductions point at', async () => {
    builder.result = {
      data: [{ transaction_id: 't1' }, { transaction_id: null }, { transaction_id: 't2' }],
      error: null,
    }
    const { result } = renderHook(() => useDeductedTransactionIds(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(from).toHaveBeenCalledWith('deduction')
    expect(builder.not).toHaveBeenCalledWith('transaction_id', 'is', null)
    expect(result.current.ids).toEqual(new Set(['t1', 't2']))
  })

  it('stays unloaded when the read fails', async () => {
    builder.result = { data: null, error: new Error('boom') }
    const { result } = renderHook(() => useDeductedTransactionIds(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.ids).toBeNull()
  })
})

describe('useSourceTransactions', () => {
  it('reads the named transactions by id', async () => {
    const row = { id: 't1', description: 'Bunnings', amount_cents: -5_00, posted_at: '2026-08-01' }
    builder.result = { data: [row], error: null }
    const { result } = renderHook(() => useSourceTransactions(['t1', 't1']), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(from).toHaveBeenCalledWith('transactions')
    expect(builder.in).toHaveBeenCalledWith('id', ['t1'])
    expect(result.current.transactions).toEqual({ t1: row })
  })

  it('skips the read when there is nothing to look up', async () => {
    const { result } = renderHook(() => useSourceTransactions([]), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(from).not.toHaveBeenCalled()
    expect(result.current.transactions).toEqual({})
  })

  it('has no transactions when the read fails', async () => {
    builder.result = { data: null, error: new Error('boom') }
    const { result } = renderHook(() => useSourceTransactions(['t1']), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.transactions).toEqual({})
  })
})
