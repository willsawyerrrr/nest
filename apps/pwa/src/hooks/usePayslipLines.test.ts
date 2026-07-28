import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayslipLine } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { usePayslipLines, type PayslipLineInput } from './usePayslipLines'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const line = makePayslipLine()

const inputs: PayslipLineInput[] = [
  { source_inflow_id: 'i1', label: 'Ordinary Hours', amount_cents: 4_000_00 },
  { source_inflow_id: 'i2', label: 'On-call (T1)', amount_cents: 495_50 },
]

/** Renders the hook and waits for its first load to settle. */
async function renderLines() {
  const { result } = renderHook(() => usePayslipLines('h1'), { wrapper: makeWrapper() })
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

  it('replaces a payslip’s lines, clearing the old set before inserting the new', async () => {
    const result = await renderLines()

    await act(async () => {
      await result.current.replace('ps1', inputs)
    })

    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('payslip_id', 'ps1')
    expect(builder.insert).toHaveBeenCalledWith([
      { ...inputs[0], payslip_id: 'ps1', household_id: 'h1' },
      { ...inputs[1], payslip_id: 'ps1', household_id: 'h1' },
    ])
  })

  it('clears a payslip’s lines without an empty insert when it is unitemised', async () => {
    const result = await renderLines()

    await act(async () => {
      await result.current.replace('ps1', [])
    })

    expect(builder.delete).toHaveBeenCalled()
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('surfaces a failure clearing the old lines', async () => {
    const result = await renderLines()
    builder.result = { data: null, error: new Error('delete failed') }

    await expect(result.current.replace('ps1', inputs)).rejects.toThrow('delete failed')
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('surfaces a failure inserting the new lines', async () => {
    const result = await renderLines()
    builder.delete.mockImplementationOnce(() => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }))
    builder.result = { data: null, error: new Error('insert failed') }

    await expect(result.current.replace('ps1', inputs)).rejects.toThrow('insert failed')
  })

  it('refetches after a replace', async () => {
    const result = await renderLines()
    builder.select.mockClear()

    await act(async () => {
      await result.current.replace('ps1', [])
    })

    await waitFor(() => expect(builder.select).toHaveBeenCalled())
  })
})
