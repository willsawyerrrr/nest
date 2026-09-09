import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDeductionReceipts, type DeductionReceiptRow } from './useDeductionReceipts'

const { builder, bucket, invoke } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    bucket: {
      upload: vi.fn(),
      remove: vi.fn(),
      createSignedUrl: vi.fn(),
    },
    invoke: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => bucket) },
    functions: { invoke },
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
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).toEqual([receipt]))
    expect(result.current.loading).toBe(false)
  })

  it('uploads a file then records a receipt row', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
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
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    await expect(result.current.upload('d1', file)).rejects.toThrow('nope')
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('removes the stored file then deletes the row', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await act(async () => {
      await result.current.remove(receipt)
    })

    expect(bucket.remove).toHaveBeenCalledWith(['h1/d1/abc-receipt.pdf'])
    expect(builder.delete).toHaveBeenCalled()
  })

  it('does not delete the row when removing the stored file fails', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await expect(result.current.remove(receipt)).rejects.toThrow('nope')
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('returns a signed URL for a stored path', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const url = await result.current.signedUrl('h1/d1/abc-receipt.pdf')
    expect(url).toBe('https://x/y')
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('h1/d1/abc-receipt.pdf', 3600)
  })

  it('returns null when signing the URL fails', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    expect(await result.current.signedUrl('h1/d1/abc-receipt.pdf')).toBeNull()
  })

  it('uploads a file for a not-yet-created deduction without recording a row', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    const pending = await result.current.uploadPending('d2', file)

    const [path, uploaded] = bucket.upload.mock.calls[0]!
    expect(path).toMatch(/^h1\/d2\/.*-receipt\.pdf$/)
    expect(uploaded).toBe(file)
    expect(pending).toEqual({ storage_path: path, file_name: 'receipt.pdf' })
    // create_deduction_with_receipts writes the row, not this call.
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('discards a pending upload from Storage', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await expect(result.current.discardPending('h1/d2/uuid-receipt.pdf')).resolves.toBeUndefined()
    expect(bucket.remove).toHaveBeenCalledWith(['h1/d2/uuid-receipt.pdf'])
  })

  it('swallows a failure discarding a pending upload', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await expect(result.current.discardPending('h1/d2/uuid-receipt.pdf')).resolves.toBeUndefined()
    expect(bucket.remove).toHaveBeenCalledWith(['h1/d2/uuid-receipt.pdf'])
  })

  it('reads an uploaded receipt through deduction-extract', async () => {
    invoke.mockResolvedValue({
      data: { model: 'claude-haiku-4-5-20251001', fields: { description: 'Officeworks' } },
      error: null,
      response: undefined,
    })
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const outcome = await result.current.extract('h1/d2/uuid-receipt.pdf', 'work_expense')

    expect(invoke).toHaveBeenCalledWith('deduction-extract', {
      body: { path: 'h1/d2/uuid-receipt.pdf', category: 'work_expense' },
    })
    expect(outcome).toEqual({
      status: 'read',
      extraction: { model: 'claude-haiku-4-5-20251001', fields: { description: 'Officeworks' } },
    })
  })

  it('reads a non-2xx reply from deduction-extract into a failure state', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error('status 503'),
      response: new Response(
        JSON.stringify({ error: 'Receipt extraction is not configured.', configured: false }),
        { status: 503 },
      ),
    })
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    const outcome = await result.current.extract('h1/d2/uuid-receipt.pdf', 'work_expense')

    expect(outcome).toEqual({
      status: 'not-configured',
      message: 'Receipt extraction is not configured.',
    })
  })

  it('falls back to a plain message when the failure carries no readable body', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error('bad gateway'),
      response: new Response('<html>502</html>', { status: 502 }),
    })
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    expect(await result.current.extract('h1/d2/uuid-receipt.pdf', 'work_expense')).toEqual({
      status: 'failed',
      message: 'Could not read this receipt. Enter the details by hand.',
    })
  })

  it('renames a receipt’s display label, leaving its stored file untouched', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await act(async () => {
      await result.current.rename(receipt, 'Officeworks invoice.pdf')
    })

    expect(builder.update).toHaveBeenCalledWith({ file_name: 'Officeworks invoice.pdf' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'r1')
    // Only the label changes: no Storage call touches the underlying file.
    expect(bucket.upload).not.toHaveBeenCalled()
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('stores a receipt named nothing under Receipt', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    await act(async () => {
      await result.current.rename(receipt, '   ')
    })
    const pending = await result.current.uploadPending('d2', new File(['x'], ''))

    expect(builder.update).toHaveBeenCalledWith({ file_name: 'Receipt' })
    expect(pending.file_name).toBe('Receipt')
  })

  it('surfaces a failed rename', async () => {
    const { result } = renderHook(() => useDeductionReceipts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.receipts).not.toBeNull())

    builder.result = { data: null, error: new Error('nope') }
    await expect(result.current.rename(receipt, 'New name.pdf')).rejects.toThrow('nope')
  })
})
