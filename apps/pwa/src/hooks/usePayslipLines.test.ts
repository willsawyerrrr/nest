import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayslipLine } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { usePayslipLines } from './usePayslipLines'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const line = makePayslipLine()

/** Renders the hook and waits for its first load to settle. */
async function renderLines() {
  const { result } = renderHook(() => usePayslipLines(), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current.lines).not.toBeNull())
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [line], error: null }
})

describe('usePayslipLines', () => {
  it('loads the household’s earnings lines in entry order', async () => {
    const result = await renderLines()

    expect(result.current.lines).toEqual([line])
    expect(result.current.loading).toBe(false)
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('refetches on demand', async () => {
    const result = await renderLines()
    builder.select.mockClear()

    await result.current.reload()

    await waitFor(() => expect(builder.select).toHaveBeenCalled())
  })
})
