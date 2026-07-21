import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useConfirmDelete } from './useConfirmDelete'

type ModalProps = { onConfirm: () => void; onCancel: () => void; deleting: boolean }

describe('useConfirmDelete', () => {
  it('runs the queued delete on confirmation and clears it', async () => {
    const { result } = renderHook(() => useConfirmDelete())

    // With nothing queued, confirming is a no-op.
    act(() => {
      ;(result.current.modal.props as ModalProps).onConfirm()
    })

    const onConfirm = vi.fn().mockResolvedValue(undefined)
    act(() => {
      result.current.confirm({ title: 'Delete goal?', itemLabel: 'Goal', onConfirm })
    })
    expect((result.current.modal.props as ModalProps).deleting).toBe(false)

    act(() => {
      ;(result.current.modal.props as ModalProps).onConfirm()
    })
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())

    act(() => {
      ;(result.current.modal.props as ModalProps).onCancel()
    })
  })
})
