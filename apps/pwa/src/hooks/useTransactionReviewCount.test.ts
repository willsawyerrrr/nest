import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useTransactionReviewCount } from './useTransactionReviewCount'

const { builder, from } = vi.hoisted(() => {
  const builder = {
    result: { count: 4 as number | null, error: null as unknown },
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(builder.result).then(resolve),
  }
  for (const method of ['select', 'eq', 'is'] as const) {
    builder[method].mockImplementation(() => builder)
  }
  return { builder, from: vi.fn(() => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { count: 4, error: null }
})

describe('useTransactionReviewCount', () => {
  it('counts the categorisable, unreviewed Up transactions the review screen lists', async () => {
    const { result } = renderHook(() => useTransactionReviewCount(true), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current).toBe(4))

    expect(from).toHaveBeenCalledWith('transactions')
    expect(builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(builder.eq).toHaveBeenCalledWith('source', 'up')
    expect(builder.eq).toHaveBeenCalledWith('is_categorizable', true)
    expect(builder.is).toHaveBeenCalledWith('reviewed_at', null)
  })

  it('reads a missing count as none', async () => {
    builder.result = { count: null, error: null }
    const { result } = renderHook(() => useTransactionReviewCount(true), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current).toBe(0))
  })

  it('stays unresolved when the count fails', async () => {
    builder.result = { count: null, error: new Error('denied') }
    const { result } = renderHook(() => useTransactionReviewCount(true), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(from).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('reads nothing while the review prompt is off', async () => {
    const { result } = renderHook(() => useTransactionReviewCount(false), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(from).not.toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
