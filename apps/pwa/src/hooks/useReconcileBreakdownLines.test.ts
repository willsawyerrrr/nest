import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DerivedAmountContext } from '../lib/breakdowns'
import type { DirectoryAccount } from '../lib/gifts'
import { makeBudgetLine } from '../test/fixtures'
import type { Breakdown } from './useBreakdowns'
import { useReconcileBreakdownLines } from './useReconcileBreakdownLines'

function context(overrides: Partial<DerivedAmountContext> = {}): DerivedAmountContext {
  return {
    genericTotalsByBreakdownId: new Map(),
    giftBreakdownId: null,
    giftTotalsByMember: new Map(),
    ...overrides,
  }
}

function makeBreakdown(overrides: Partial<Breakdown> = {}): Breakdown {
  return {
    id: 'bd1',
    household_id: 'h1',
    name: 'Meds',
    line_group: 'needs',
    kind: 'generic',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function params(overrides: Partial<Parameters<typeof useReconcileBreakdownLines>[0]> = {}) {
  return {
    lines: [] as ReturnType<typeof makeBudgetLine>[] | null,
    dataLoaded: true,
    breakdowns: [] as Breakdown[],
    context: context(),
    counts: new Map<string, number>(),
    memberNames: new Map<string, string>(),
    members: [] as { id: string }[],
    directory: [] as DirectoryAccount[],
    createLine: vi.fn().mockResolvedValue(undefined),
    updateLine: vi.fn().mockResolvedValue(undefined),
    removeLine: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useReconcileBreakdownLines', () => {
  it('creates, updates, and removes the derived lines the reconcile yields', async () => {
    const p = params({
      breakdowns: [
        makeBreakdown({ id: 'A', name: 'A' }),
        makeBreakdown({ id: 'B', name: 'B' }),
        makeBreakdown({ id: 'C', name: 'C' }),
      ],
      context: context({
        genericTotalsByBreakdownId: new Map([
          ['A', 100],
          ['B', 500],
        ]),
      }),
      counts: new Map([
        ['A', 1],
        ['B', 1],
        ['C', 0],
      ]),
      lines: [
        makeBudgetLine({ id: 'lineB', breakdown_id: 'B', name: 'B', amount_cents: 999 }),
        makeBudgetLine({ id: 'lineC', breakdown_id: 'C', destination_account_id: null }),
      ],
    })
    renderHook(() => useReconcileBreakdownLines(p))
    await waitFor(() => {
      expect(p.createLine).toHaveBeenCalledTimes(1)
      expect(p.updateLine).toHaveBeenCalledWith('lineB', expect.anything())
      expect(p.removeLine).toHaveBeenCalledWith('lineC')
    })
  })

  it('funds a gift member line from the buyer’s account, threading members and directory', async () => {
    const p = params({
      breakdowns: [makeBreakdown({ id: 'gift', name: 'Gifts', kind: 'gift', line_group: 'wants' })],
      context: context({
        giftBreakdownId: 'gift',
        giftTotalsByMember: new Map([['m-sam', 120_00]]),
      }),
      memberNames: new Map([['m-sam', 'Sam']]),
      members: [{ id: 'm-sam' }, { id: 'm-will' }],
      directory: [{ id: 'will-txn', owner_member_id: 'm-will', type: 'transaction' }],
      lines: [],
    })
    renderHook(() => useReconcileBreakdownLines(p))
    await waitFor(() =>
      expect(p.createLine).toHaveBeenCalledWith(
        expect.objectContaining({
          gift_recipient_member_id: 'm-sam',
          destination_account_id: 'will-txn',
        }),
      ),
    )
  })

  it('does nothing while lines are null, data is unloaded, or there are no ops', () => {
    const nullLines = params({ lines: null })
    renderHook(() => useReconcileBreakdownLines(nullLines))
    expect(nullLines.createLine).not.toHaveBeenCalled()

    const unloaded = params({ dataLoaded: false })
    renderHook(() => useReconcileBreakdownLines(unloaded))
    expect(unloaded.createLine).not.toHaveBeenCalled()

    const empty = params()
    renderHook(() => useReconcileBreakdownLines(empty))
    expect(empty.createLine).not.toHaveBeenCalled()
    expect(empty.updateLine).not.toHaveBeenCalled()
    expect(empty.removeLine).not.toHaveBeenCalled()
  })
})
