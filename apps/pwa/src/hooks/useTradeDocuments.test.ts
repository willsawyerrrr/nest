import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useTradeDocuments } from './useTradeDocuments'

const { builder, bucket, invoke, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    bucket: { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
    invoke: vi.fn(),
    rpc: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => bucket) },
    functions: { invoke },
    rpc,
  },
}))

const document = { id: 'd1', household_id: 'h1', storage_path: 'h1/d1/x-note.pdf', created_at: '' }
const input = {
  member_id: 'm1',
  ticker: 'VAS',
  side: 'buy' as const,
  traded_on: '2026-01-01',
  units: 10,
  price_per_unit_cents: 90_00,
  fee_cents: 9_50,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [document], error: null }
  bucket.upload.mockResolvedValue({ data: {}, error: null })
  bucket.remove.mockResolvedValue({ data: {}, error: null })
  bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/y' }, error: null })
  rpc.mockResolvedValue({ data: 1, error: null })
})

async function setup(financialYear?: number) {
  const hook = renderHook(() => useTradeDocuments(financialYear), { wrapper: makeWrapper() })
  await waitFor(() => expect(hook.result.current.documents).not.toBeNull())
  return hook.result
}

describe('useTradeDocuments', () => {
  it('exposes the household documents', async () => {
    const result = await setup()
    expect(result.current.documents).toEqual([document])
  })

  it('uploads a file under the document id with no database row', async () => {
    const result = await setup()
    const file = new File(['x'], 'note.pdf', { type: 'application/pdf' })

    let path = ''
    await act(async () => {
      path = await result.current.upload('d1', file)
    })

    expect(path).toMatch(/^h1\/d1\/.*-note\.pdf$/)
    expect(bucket.upload).toHaveBeenCalledWith(path, file)
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('throws when the upload fails', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: new Error('nope') })
    const result = await setup()

    await expect(result.current.upload('d1', new File(['x'], 'n.pdf'))).rejects.toThrow('nope')
  })

  it('discards an object, swallowing a failure', async () => {
    const result = await setup()
    await result.current.discard('h1/d1/x')
    expect(bucket.remove).toHaveBeenCalledWith(['h1/d1/x'])

    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    await expect(result.current.discard('h1/d1/x')).resolves.toBeUndefined()
  })

  it('reads a document through trade-extract with the financial year', async () => {
    invoke.mockResolvedValue({
      data: { model: 'm', trades: [{ fields: { ticker: 'VAS' }, missing: [], unreadable: [] }] },
      error: null,
    })
    const result = await setup(2026)

    const outcome = await result.current.extract('h1/d1/x')

    expect(invoke).toHaveBeenCalledWith('trade-extract', {
      body: { path: 'h1/d1/x', financialYear: 2026 },
    })
    expect(outcome).toEqual({
      status: 'read',
      trades: [{ values: { ticker: 'VAS' }, check: [] }],
    })
  })

  it('defaults to the current financial year', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    const result = await setup()

    await result.current.extract('h1/d1/x')

    const { financialYear } = invoke.mock.calls[0]![1].body
    expect(Number.isInteger(financialYear)).toBe(true)
  })

  it('reports a reply it cannot read as a failure', async () => {
    invoke.mockResolvedValue({ data: { nope: true }, error: null })
    const result = await setup()

    expect(await result.current.extract('h1/d1/x')).toMatchObject({ status: 'failed' })
  })

  it("reads a failed call's fixed message from its response", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error('non-2xx'),
      response: new Response(JSON.stringify({ code: 'no_trades', error: 'No trades found.' })),
    })
    const result = await setup()

    expect(await result.current.extract('h1/d1/x')).toEqual({
      status: 'failed',
      message: 'No trades found.',
    })
  })

  it('falls back when a failed call has no readable response', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('offline') })
    invoke.mockResolvedValueOnce({
      data: null,
      error: new Error('non-2xx'),
      response: new Response('not json'),
    })
    const result = await setup()

    expect(await result.current.extract('h1/d1/x')).toMatchObject({ status: 'failed' })
    expect(await result.current.extract('h1/d1/x')).toMatchObject({ status: 'failed' })
  })

  it('saves a trade and its document in one RPC', async () => {
    const result = await setup()

    await act(async () => {
      await result.current.save({ documentId: 'd1', path: 'h1/d1/x', id: 't1', input })
    })

    expect(rpc).toHaveBeenCalledWith('create_trades_with_document', {
      p_household_id: 'h1',
      p_document_id: 'd1',
      p_document_path: 'h1/d1/x',
      p_trades: [{ ...input, id: 't1' }],
    })
  })

  it('throws when the save fails', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('rls') })
    const result = await setup()

    await expect(
      result.current.save({ documentId: 'd1', path: 'h1/d1/x', id: 't1', input }),
    ).rejects.toThrow('rls')
  })

  it('brokers a signed URL, or null on failure', async () => {
    const result = await setup()
    expect(await result.current.signedUrl('h1/d1/x')).toBe('https://x/y')

    bucket.createSignedUrl.mockResolvedValue({ data: null, error: new Error('nope') })
    expect(await result.current.signedUrl('h1/d1/x')).toBeNull()
  })
})
