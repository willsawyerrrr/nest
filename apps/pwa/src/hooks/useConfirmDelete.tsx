import { useCallback, useState } from 'react'
import { ConfirmDeleteModal, type ConfirmDeleteTarget } from '../components/ConfirmDeleteModal'

/**
 * Drives a single shared {@link ConfirmDeleteModal}: `confirm(target)` queues a
 * delete for confirmation, and `modal` is the dialog to render once. The queued
 * `onConfirm` runs on confirmation with a loading state held until it settles.
 */
export function useConfirmDelete() {
  const [target, setTarget] = useState<ConfirmDeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirm = useCallback((next: ConfirmDeleteTarget) => setTarget(next), [])
  const cancel = useCallback(() => setTarget(null), [])

  const run = async () => {
    if (!target) {
      return
    }
    setDeleting(true)
    try {
      await target.onConfirm()
      setTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const modal = (
    <ConfirmDeleteModal
      target={target}
      deleting={deleting}
      onConfirm={() => void run()}
      onCancel={cancel}
    />
  )

  return { confirm, modal }
}
