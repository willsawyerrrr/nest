import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useActualSpend } from './useActualSpend'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabase: { rpc, from: vi.fn() } }))

const period = { periodStart: '2026-11-12', periodEnd: '2026-11-25' }

beforeEach(() => vi.clearAllMocks())

describe('useActualSpend', () => {
  it('reads the period’s spend per group and folds it', async () => {
    rpc.mockResolvedValue({
      data: [
        { line_group: 'needs', spent_cents: 120_00 },
        { line_group: null, spent_cents: 8_00 },
      ],
      error: null,
    })
    const { result } = renderHook(() => useActualSpend(period, true), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).not.toBeNull())

    expect(rpc).toHaveBeenCalledWith('budget_actual_spend', {
      p_start: '2026-11-12',
      p_end: '2026-11-25',
      p_include_pending: true,
    })
    expect(result.current?.groups.needs).toBe(120_00)
    expect(result.current?.unbudgeted).toBe(8_00)
  })

  it('stays unresolved when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('denied') })
    const { result } = renderHook(() => useActualSpend(period, false), { wrapper: makeWrapper() })
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
