import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDeductions, type DeductionInput, type DeductionSubmission } from './useDeductions'

const { builder, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    rpc: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder), rpc } }))

const input: DeductionInput = {
  member_id: 'm1',
  description: 'Home office',
  amount_cents: 300_00,
  deduction_date: '2026-09-01',
}

/** What a form submits when adding: the id it minted, its fields, and its receipts. */
const submission: DeductionSubmission = {
  id: 'd2',
  input,
  receipts: [{ storage_path: 'h1/d2/uuid-receipt.pdf', file_name: 'receipt.pdf' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'd1' }], error: null }
  rpc.mockResolvedValue({ data: 'd2', error: null })
})

describe('useDeductions', () => {
  it('exposes the household deductions for the financial year and mutates them', async () => {
    const { result } = renderHook(() => useDeductions('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.deductions).toEqual([{ id: 'd1' }]))
    expect(result.current.loading).toBe(false)
    expect(result.current.financialYear).toBeGreaterThan(2000)

    await act(async () => {
      await result.current.create(submission)
      await result.current.update('d1', input)
      await result.current.remove('d1')
      await result.current.reload()
    })

    // The load is scoped to the current financial year.
    expect(builder.eq).toHaveBeenCalledWith('financial_year', result.current.financialYear)
    // Creating a deduction writes it and its already-uploaded receipts in one
    // RPC call, keyed on the id the submission carries.
    expect(rpc).toHaveBeenCalledWith('create_deduction_with_receipts', {
      p_deduction: {
        ...input,
        id: 'd2',
        household_id: 'h1',
        financial_year: result.current.financialYear,
      },
      p_receipts: [...submission.receipts],
    })
    // Editing an existing deduction stays a plain field update.
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'd1')
  })

  it('scopes to an explicit financial year when given one', async () => {
    const { result } = renderHook(() => useDeductions('h1', 2025), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.deductions).toEqual([{ id: 'd1' }]))
    expect(result.current.financialYear).toBe(2025)

    await act(async () => {
      await result.current.create(submission)
    })

    expect(builder.eq).toHaveBeenCalledWith('financial_year', 2025)
    expect(rpc).toHaveBeenCalledWith('create_deduction_with_receipts', {
      p_deduction: { ...input, id: 'd2', household_id: 'h1', financial_year: 2025 },
      p_receipts: [...submission.receipts],
    })
  })

  it('surfaces a failed create without reloading', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductions('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.deductions).not.toBeNull())

    await expect(result.current.create(submission)).rejects.toThrow('nope')
  })
})
