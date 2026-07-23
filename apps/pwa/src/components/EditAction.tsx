import type { MouseEventHandler } from 'react'
import { ActionIcon, type ActionIconProps } from '@mantine/core'
import { IconPencil } from '@tabler/icons-react'

interface EditActionProps extends ActionIconProps {
  onClick?: MouseEventHandler<HTMLButtonElement>
}

/**
 * The shared pencil edit control: a subtle `ActionIcon` labelled `Edit`. The one
 * edit affordance so the bespoke per-screen copies collapse onto it.
 */
export function EditAction(props: EditActionProps) {
  return (
    <ActionIcon aria-label="Edit" {...props}>
      <IconPencil size={16} />
    </ActionIcon>
  )
}
