import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import type { Breakdown } from './useBreakdowns'
import { useDerivedLineEditor } from './useDerivedLineEditor'

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

describe('useDerivedLineEditor', () => {
  it('fans a generic derived-line save out to the breakdown and the line', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)
    const line = makeBudgetLine({ id: 'l1', breakdown_id: 'bd1' })
    const { result } = renderHook(() =>
      useDerivedLineEditor({
        lines: [line],
        breakdowns: [makeBreakdown({ id: 'bd1' })],
        updateBreakdown,
        updateLine,
      }),
    )

    await act(async () => {
      await result.current('l1', { name: 'N', line_group: 'wants', destination_account_id: 'acc1' })
    })

    expect(updateBreakdown).toHaveBeenCalledWith('bd1', { name: 'N', line_group: 'wants' })
    expect(updateLine).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'N',
        line_group: 'wants',
        breakdown_id: 'bd1',
        destination_account_id: 'acc1',
      }),
    )
  })

  it('leaves a gift line’s name and breakdown name untouched, flowing only group and account', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)
    const line = makeBudgetLine({
      id: 'l1',
      breakdown_id: 'gift',
      name: 'Gifts for Sam',
      gift_recipient_member_id: 'm-sam',
    })
    const { result } = renderHook(() =>
      useDerivedLineEditor({
        lines: [line],
        breakdowns: [makeBreakdown({ id: 'gift', name: 'Gifts', kind: 'gift' })],
        updateBreakdown,
        updateLine,
      }),
    )

    await act(async () => {
      await result.current('l1', {
        name: 'Anything',
        line_group: 'discretionary',
        destination_account_id: 'acc2',
      })
    })

    // The breakdown keeps its own name; only the group flows.
    expect(updateBreakdown).toHaveBeenCalledWith('gift', {
      name: 'Gifts',
      line_group: 'discretionary',
    })
    expect(updateLine).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Gifts for Sam',
        line_group: 'discretionary',
        destination_account_id: 'acc2',
        gift_recipient_member_id: 'm-sam',
      }),
    )
  })

  it('is a no-op when the line is missing or has no breakdown', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)

    const missing = renderHook(() =>
      useDerivedLineEditor({ lines: null, breakdowns: [], updateBreakdown, updateLine }),
    )
    await act(async () => {
      await missing.result.current('nope', {
        name: 'N',
        line_group: 'wants',
        destination_account_id: null,
      })
    })

    const manual = renderHook(() =>
      useDerivedLineEditor({
        lines: [makeBudgetLine({ id: 'l2', breakdown_id: null })],
        breakdowns: [],
        updateBreakdown,
        updateLine,
      }),
    )
    await act(async () => {
      await manual.result.current('l2', {
        name: 'N',
        line_group: 'wants',
        destination_account_id: null,
      })
    })

    expect(updateBreakdown).not.toHaveBeenCalled()
    expect(updateLine).not.toHaveBeenCalled()
  })
})
