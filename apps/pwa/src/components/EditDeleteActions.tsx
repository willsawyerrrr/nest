import { ActionIcon } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'

/** A pencil edit control beside a red trash delete control, shared across the lists. */
export function EditDeleteActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <>
      <ActionIcon variant="subtle" aria-label="Edit" onClick={onEdit}>
        <IconPencil size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="red" aria-label="Delete" onClick={onDelete}>
        <IconTrash size={16} />
      </ActionIcon>
    </>
  )
}
