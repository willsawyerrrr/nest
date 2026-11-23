import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REVIEWABLE_FILTER, ReviewError } from '../lib/transactionReview'
import { makeWrapper } from '../test/queryWrapper'
import { useTransactionReview } from './useTransactionReview'

const { builder, from, rpc, invoke } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'eq', 'or', 'is', 'order', 'limit', 'maybeSingle'])
  return {
    builder,
    from: vi.fn((_table: string) => builder),
    rpc: vi.fn(),
    invoke: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({ supabase: { from, rpc, functions: { invoke } } }))

const FOCUS_ID = '11111111-2222-3333-4444-555555555555'

function failure(code: string) {
  return Object.assign(new Error('failed'), {
    context: new Response(JSON.stringify({ code, error: 'upstream copy' })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
  rpc.mockResolvedValue({ data: {}, error: null })
  invoke.mockResolvedValue({ data: {}, error: null })
})

async function loaded(focusId: string | null = null) {
  const hook = renderHook(() => useTransactionReview(focusId), { wrapper: makeWrapper() })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('useTransactionReview', () => {
  it('loads the unreviewed categorisable Up transactions, newest first and bounded', async () => {
    await loaded()

    expect(from).toHaveBeenCalledWith('transactions')
    expect(from).toHaveBeenCalledWith('up_category')
    expect(builder.eq).toHaveBeenCalledWith('source', 'up')
    expect(builder.or).toHaveBeenCalledWith(REVIEWABLE_FILTER)
    expect(builder.is).toHaveBeenCalledWith('reviewed_at', null)
    expect(builder.order).toHaveBeenCalledWith('posted_at', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(100)
    expect(builder.maybeSingle).not.toHaveBeenCalled()
  })

  it('reads the focused transaction by id, reviewed or not', async () => {
    builder.result = { data: { id: FOCUS_ID }, error: null }
    const { result } = await loaded(FOCUS_ID)

    expect(builder.eq).toHaveBeenCalledWith('id', FOCUS_ID)
    expect(builder.maybeSingle).toHaveBeenCalled()
    expect(result.current.focused).toEqual({ id: FOCUS_ID })
  })

  it('stays loading while the focused read fails', async () => {
    builder.maybeSingle.mockImplementationOnce(() => ({
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: new Error('focus failed') }).then(resolve),
    }))
    const { result } = renderHook(() => useTransactionReview(FOCUS_ID), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(builder.maybeSingle).toHaveBeenCalled())
    expect(result.current.loading).toBe(true)
  })

  it('ignores an id that is not a uuid', async () => {
    const { result } = await loaded('not-a-uuid')
    expect(builder.maybeSingle).not.toHaveBeenCalled()
    expect(result.current.focused).toBeNull()
  })

  it('reports loading while a read is unresolved', () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useTransactionReview(null), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })

  it('confirms a transaction with its note, leaving the category alone', async () => {
    const { result } = await loaded()

    await act(() => result.current.review('t1', { note: 'Dinner' }))

    expect(invoke).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('review_transaction', {
      p_transaction_id: 't1',
      p_note: 'Dinner',
    })
  })

  it('sets the category on Up before recording the review', async () => {
    const { result } = await loaded()

    await act(() => result.current.review('t1', { note: '', categoryId: 'groceries' }))

    expect(invoke).toHaveBeenCalledWith('up-categorise', {
      body: { transaction_id: 't1', category_id: 'groceries' },
    })
    expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]!)
  })

  it('leaves the transaction unreviewed when Up refuses the category', async () => {
    invoke.mockResolvedValue({ data: null, error: failure('up_rate_limited') })
    const { result } = await loaded()

    const error = await result.current
      .review('t1', { note: '', categoryId: 'groceries' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReviewError)
    expect((error as ReviewError).code).toBe('up_rate_limited')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('leaves the transaction unreviewed when Up took the category but Nest could not', async () => {
    invoke.mockResolvedValue({ data: null, error: failure('save_failed') })
    const { result } = await loaded()

    const error = await result.current
      .review('t1', { note: '', categoryId: 'groceries' })
      .catch((caught: unknown) => caught)

    expect((error as ReviewError).code).toBe('save_failed')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects with a code-less error when the review cannot be recorded', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = await loaded()

    const error = await result.current.review('t1', { note: '' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReviewError)
    expect((error as ReviewError).code).toBeNull()
  })

  it('reloads the review list after a review', async () => {
    const { result } = await loaded()
    const before = from.mock.calls.length

    await act(() => result.current.review('t1', { note: '' }))

    await waitFor(() => expect(from.mock.calls.length).toBeGreaterThan(before))
  })

  it('marks many reviewed, keeping each note, and reports the ones refused', async () => {
    rpc.mockImplementation((_name: string, args: { p_transaction_id: string }) =>
      Promise.resolve(
        args.p_transaction_id === 't2'
          ? { data: null, error: { message: 'no' } }
          : { data: {}, error: null },
      ),
    )
    const { result } = await loaded()

    const outcome = await act(() => result.current.reviewMany(['t1', 't2', 't3']))

    expect(outcome).toEqual({ failed: [{ id: 't2', code: null }] })
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(rpc).toHaveBeenCalledWith('review_transaction', { p_transaction_id: 't1' })
  })

  it('sets one category on many in a single request, reviewing only those Up took', async () => {
    invoke.mockResolvedValue({
      data: {
        results: [
          { transaction_id: 't1' },
          { transaction_id: 't2', code: 'up_rejected' },
          { transaction_id: 't3' },
        ],
      },
      error: null,
    })
    const { result } = await loaded()

    const outcome = await act(() => result.current.categoriseMany(['t1', 't2', 't3'], 'groceries'))

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('up-categorise', {
      body: { transaction_ids: ['t1', 't2', 't3'], category_id: 'groceries' },
    })
    expect(
      rpc.mock.calls.map(([, args]) => (args as { p_transaction_id: string }).p_transaction_id),
    ).toEqual(['t1', 't3'])
    expect(outcome).toEqual({ failed: [{ id: 't2', code: 'up_rejected' }] })
  })

  it('fails every transaction in a batch Up refuses as a whole', async () => {
    invoke.mockResolvedValue({ data: null, error: failure('up_not_connected') })
    const { result } = await loaded()

    const outcome = await act(() => result.current.categoriseMany(['t1', 't2'], 'groceries'))

    expect(rpc).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      failed: [
        { id: 't1', code: 'up_not_connected' },
        { id: 't2', code: 'up_not_connected' },
      ],
    })
  })
})
