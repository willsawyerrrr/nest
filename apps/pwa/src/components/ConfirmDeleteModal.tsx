import { type ReactNode } from 'react'
import { Button, Group, Modal, Stack, Text } from '@mantine/core'

/** A queued destructive delete awaiting confirmation. */
export interface ConfirmDeleteTarget {
  /** The modal heading, e.g. `Delete goal?`. */
  title: string
  /** The name of the thing being removed, shown in bold in the body. */
  itemLabel: string
  /** The consequence spelled out after the name; defaults to a can't-be-undone note. */
  description?: ReactNode
  /** Removes the target once confirmed. */
  onConfirm: () => void | Promise<void>
}

const DEFAULT_DESCRIPTION = 'This cannot be undone.'

/**
 * A centered confirm dialog guarding a destructive delete: a red, loading-aware
 * Delete button beside Cancel, naming the target and spelling out the
 * consequence. Closing is blocked while the delete is in flight.
 */
export function ConfirmDeleteModal({
  target,
  deleting,
  onConfirm,
  onCancel,
}: {
  target: ConfirmDeleteTarget | null
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      opened={target !== null}
      onClose={() => (deleting ? undefined : onCancel())}
      title={target?.title ?? 'Delete?'}
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          Delete <b>{target?.itemLabel}</b>? {target?.description ?? DEFAULT_DESCRIPTION}
        </Text>
        <Group grow>
          <Button color="red" onClick={onConfirm} loading={deleting}>
            Delete
          </Button>
          <Button variant="default" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
