import type { MouseEventHandler } from 'react'
import { Button, type ButtonProps } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'

interface AddButtonProps extends ButtonProps {
  /** The button label, e.g. `Add deduction`. */
  label: string
  onClick?: MouseEventHandler<HTMLButtonElement>
}

/**
 * The one "Add …" affordance: a full-width, solid electric-lime button with a
 * leading plus icon and the theme's lime glow, settling the variant and size for
 * every add action in the app as the assertive primary action.
 */
export function AddButton({ label, ...buttonProps }: AddButtonProps) {
  return (
    <Button fullWidth leftSection={<IconPlus size={16} />} {...buttonProps}>
      {label}
    </Button>
  )
}
