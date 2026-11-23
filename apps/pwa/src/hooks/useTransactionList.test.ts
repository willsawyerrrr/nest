import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDayStart } from '../lib/dates'
import { TRANSACTION_PAGE_SIZE, type TransactionFilters } from '../lib/transactionList'
import { makeWrapper } from '../test/queryWrapper'
import { useTransactionList } from './useTransactionList'

const { builder, from } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'eq', 'is', 'or', 'gte', 'lt', 'order', 'range'])
  return { builder, from: vi.fn((_table: string) => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

const NONE: TransactionFilters = {
  account: null,
  from: null,
  to: null,
  kind: null,
  status: null,
  category: null,
}

function page(size: number, offset = 0) {
  return Array.from({ length: size }, (_, index) => ({ id: `t${offset + index}` }))
}

async function loaded(filters: TransactionFilters = NONE) {
  const hook = renderHook(() => useTransactionList(filters), { wrapper: makeWrapper() })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useTransactionList', () => {
  it('loads the first page of every transaction, newest first, unfiltered', async () => {
    const { result } = await loaded()

    expect(from).toHaveBeenCalledWith('transactions')
    expect(builder.eq).not.toHaveBeenCalled()
    expect(builder.is).not.toHaveBeenCalled()
    expect(builder.or).not.toHaveBeenCalled()
    expect(builder.order).toHaveBeenCalledWith('posted_at', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: false })
    expect(builder.range).toHaveBeenCalledWith(0, TRANSACTION_PAGE_SIZE - 1)
    expect(result.current.transactions).toEqual([])
    expect(result.current.hasMore).toBe(false)
  })

  it('applies every filter server-side, the end date taking all of its local day', async () => {
    await loaded({
      account: 'a1',
      from: '2026-07-01',
      to: '2026-07-31',
      kind: 'expense',
      status: 'pending',
      category: 'good-life',
    })

    expect(builder.eq).toHaveBeenCalledWith('account_id', 'a1')
    expect(builder.eq).toHaveBeenCalledWith('kind', 'expense')
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
    expect(builder.gte).toHaveBeenCalledWith('posted_at', localDayStart('2026-07-01'))
    expect(builder.lt).toHaveBeenCalledWith('posted_at', localDayStart('2026-08-01'))
    expect(builder.or).toHaveBeenCalledWith(
      'external_category.eq.good-life,external_parent_category.eq.good-life',
    )
  })

  it('filters to uncategorised transactions', async () => {
    await loaded({ ...NONE, category: 'none' })
    expect(builder.is).toHaveBeenCalledWith('external_category', null)
    expect(builder.or).not.toHaveBeenCalled()
  })

  it('loads the next page after a full one, appending it', async () => {
    builder.result = { data: page(TRANSACTION_PAGE_SIZE), error: null }
    const { result } = await loaded()
    expect(result.current.hasMore).toBe(true)

    builder.result = { data: page(3, TRANSACTION_PAGE_SIZE), error: null }
    act(() => result.current.loadMore())

    await waitFor(() => expect(result.current.transactions).toHaveLength(TRANSACTION_PAGE_SIZE + 3))
    expect(builder.range).toHaveBeenLastCalledWith(
      TRANSACTION_PAGE_SIZE,
      2 * TRANSACTION_PAGE_SIZE - 1,
    )
    expect(result.current.hasMore).toBe(false)
  })

  it('stays loading while the read fails', () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useTransactionList(NONE), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })
})
