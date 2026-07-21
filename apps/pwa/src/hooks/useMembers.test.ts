import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { useMembers } from './useMembers'

const { builder } = vi.hoisted(() => {
  const b: Record<string, unknown> & { result: { data: unknown; error: unknown } } = {
    result: { data: [], error: null },
  } as never
  for (const method of ['select', 'order']) {
    b[method] = vi.fn(() => b)
  }
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(b.result).then(onFulfilled, onRejected)
  return { builder: b }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeMember()], error: null }
})

describe('useMembers', () => {
  it('loads the household members on mount', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.members).toEqual([makeMember()]))
    expect(result.current.loading).toBe(false)
  })

  it('propagates a load error', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')
  })
})
