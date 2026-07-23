import { ActionIcon } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { EditAction } from './EditAction'

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
      <EditAction onClick={onEdit} />
      <ActionIcon variant="subtle" color="red" aria-label="Delete" onClick={onDelete}>
        <IconTrash size={16} />
      </ActionIcon>
    </>
  )
}
