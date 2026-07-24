import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDeductionReceipts, type DeductionReceiptRow } from './useDeductionReceipts'

const { builder, bucket } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    bucket: {
      upload: vi.fn(),
      remove: vi.fn(),
      createSignedUrl: vi.fn(),
    },
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => bucket) },
  },
}))

const receipt: DeductionReceiptRow = {
  id: 'r1',
  deduction_id: 'd1',
  household_id: 'h1',
  storage_path: 'h1/d1/abc-receipt.pdf',
  file_name: 'receipt.pdf',
  created_at: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [receipt], error: null }
  bucket.upload.mockResolvedValue({ data: {}, error: null })
  bucket.remove.mockResolvedValue({ data: {}, error: null })
  bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/y' }, error: null })
})

describe('useDeductionReceipts', () => {
  it('exposes the household receipts', async () => {
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).toEqual([receipt]))
    expect(result.current.loading).toBe(false)
  })

  it('uploads a file then records a receipt row', async () => {
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    await act(async () => {
      await result.current.upload('d1', file)
    })

    const [path, uploaded] = bucket.upload.mock.calls[0]!
    expect(path).toMatch(/^h1\/d1\/.*-receipt\.pdf$/)
    expect(uploaded).toBe(file)
    expect(builder.insert).toHaveBeenCalled()
  })

  it('does not record a row when the upload fails', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    await expect(result.current.upload('d1', file)).rejects.toThrow('nope')
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('removes the stored file then deletes the row', async () => {
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await act(async () => {
      await result.current.remove(receipt)
    })

    expect(bucket.remove).toHaveBeenCalledWith(['h1/d1/abc-receipt.pdf'])
    expect(builder.delete).toHaveBeenCalled()
  })

  it('does not delete the row when removing the stored file fails', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await expect(result.current.remove(receipt)).rejects.toThrow('nope')
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('returns a signed URL for a stored path', async () => {
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const url = await result.current.signedUrl('h1/d1/abc-receipt.pdf')
    expect(url).toBe('https://x/y')
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('h1/d1/abc-receipt.pdf', 3600)
  })

  it('returns null when signing the URL fails', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductionReceipts('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    expect(await result.current.signedUrl('h1/d1/abc-receipt.pdf')).toBeNull()
  })
})
