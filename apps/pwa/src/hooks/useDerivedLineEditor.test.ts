import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import { useDerivedLineEditor } from './useDerivedLineEditor'

describe('useDerivedLineEditor', () => {
  it('fans a generic derived-line save out to the breakdown and the line', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)
    const line = makeBudgetLine({ id: 'l1', breakdown_id: 'bd1' })
    const { result } = renderHook(() =>
      useDerivedLineEditor({
        lines: [line],
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

  it('writes a gift member line’s group to the line, leaving name and auto-funded account untouched', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)
    const line = makeBudgetLine({
      id: 'l1',
      is_gift_line: true,
      name: 'Gifts for Sam',
      gift_recipient_member_id: 'm-sam',
      destination_account_id: 'will-txn',
    })
    const { result } = renderHook(() =>
      useDerivedLineEditor({
        lines: [line],
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

    // A gift line's group is per-line, so the breakdown is never touched.
    expect(updateBreakdown).not.toHaveBeenCalled()
    // The edited group is written onto the line; its name stays partition-derived
    // and its auto-derived funding account is kept (the edit's 'acc2' is ignored).
    expect(updateLine).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Gifts for Sam',
        line_group: 'discretionary',
        destination_account_id: 'will-txn',
        gift_recipient_member_id: 'm-sam',
      }),
    )
  })

  it('writes a gift external line’s group to the line and sets its funding account from the edit', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)
    const line = makeBudgetLine({
      id: 'l1',
      is_gift_line: true,
      name: 'Gifts',
      gift_recipient_member_id: null,
      destination_account_id: 'joint',
    })
    const { result } = renderHook(() =>
      useDerivedLineEditor({
        lines: [line],
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

    // The external line's group is still per-line (no breakdown write), and its
    // user-set funding account flows from the edit since it is not auto-derived.
    expect(updateBreakdown).not.toHaveBeenCalled()
    expect(updateLine).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({
        name: 'Gifts',
        line_group: 'discretionary',
        destination_account_id: 'acc2',
        gift_recipient_member_id: null,
      }),
    )
  })

  it('is a no-op when the line is missing or has no breakdown', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)

    const missing = renderHook(() =>
      useDerivedLineEditor({ lines: null, updateBreakdown, updateLine }),
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
