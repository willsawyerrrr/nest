import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDocumentIntake, type DocumentIntakeRow } from './useDocumentIntake'

const { builder, bucket } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'delete', 'eq', 'order']),
    bucket: { download: vi.fn(), remove: vi.fn() },
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), storage: { from: vi.fn(() => bucket) } },
}))

const item: DocumentIntakeRow = {
  id: 'i1',
  household_id: 'h1',
  member_id: 'm1',
  kind: 'payslip',
  storage_path: 'h1/i1/slip.pdf',
  original_filename: 'slip.pdf',
  created_at: '2027-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [item], error: null }
  bucket.remove.mockResolvedValue({ data: {}, error: null })
})

describe('useDocumentIntake', () => {
  it('exposes the household’s staged documents', async () => {
    const { result } = renderHook(() => useDocumentIntake('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual([item])
  })

  it('downloads a staged item as a File named from original_filename', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    bucket.download.mockResolvedValue({ data: blob, error: null })
    const { result } = renderHook(() => useDocumentIntake('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).not.toBeNull())

    const file = await result.current.download(item)

    expect(bucket.download).toHaveBeenCalledWith('h1/i1/slip.pdf')
    expect(file.name).toBe('slip.pdf')
    expect(file.type).toBe('application/pdf')
  })

  it('falls back to the storage path’s own filename when original_filename is null', async () => {
    const blob = new Blob(['x'])
    bucket.download.mockResolvedValue({ data: blob, error: null })
    const { result } = renderHook(() => useDocumentIntake('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).not.toBeNull())

    const file = await result.current.download({ ...item, original_filename: null })

    expect(file.name).toBe('slip.pdf')
  })

  it('throws when the download fails', async () => {
    bucket.download.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDocumentIntake('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).not.toBeNull())

    await expect(result.current.download(item)).rejects.toThrow('nope')
  })

  it('clear removes the storage object then deletes the row', async () => {
    const { result } = renderHook(() => useDocumentIntake('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).not.toBeNull())

    await act(async () => {
      await result.current.clear(item)
    })

    expect(bucket.remove).toHaveBeenCalledWith(['h1/i1/slip.pdf'])
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'i1')
  })

  it('still deletes the row when the storage removal fails', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    const { result } = renderHook(() => useDocumentIntake('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).not.toBeNull())

    await act(async () => {
      await result.current.clear(item)
    })

    expect(builder.delete).toHaveBeenCalled()
  })
})
