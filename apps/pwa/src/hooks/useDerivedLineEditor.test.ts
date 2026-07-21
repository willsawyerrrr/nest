import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import { useDerivedLineEditor } from './useDerivedLineEditor'

describe('useDerivedLineEditor', () => {
  it('fans a derived-line save out to the breakdown and the line', async () => {
    const updateBreakdown = vi.fn().mockResolvedValue(undefined)
    const updateLine = vi.fn().mockResolvedValue(undefined)
    const line = makeBudgetLine({ id: 'l1', breakdown_id: 'bd1' })
    const { result } = renderHook(() =>
      useDerivedLineEditor({ lines: [line], updateBreakdown, updateLine }),
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
