import type { FormEventHandler, ReactNode } from 'react'
import { Card, type CardProps } from '@mantine/core'

interface AppCardProps extends CardProps {
  /**
   * Padding preset when `padding` is not given: `comfortable` (the default) uses
   * `lg`, `compact` uses `sm` for denser rows. An explicit `padding` wins.
   */
  density?: 'comfortable' | 'compact'
  children?: ReactNode
  /** Renders the card as a `form` element, for an inline editor. */
  component?: 'form'
  /** Submit handler when the card is rendered as a `form`. */
  onSubmit?: FormEventHandler<HTMLFormElement>
}

/**
 * The standard elevated surface: a bordered, rounded card drawing its border,
 * radius, background, and edge highlight from the theme. Replaces the repeated
 * `<Card withBorder radius=… p=…>` across the app.
 */
export function AppCard({
  density = 'comfortable',
  padding,
  children,
  ...cardProps
}: AppCardProps) {
  const resolvedPadding = padding ?? (density === 'compact' ? 'sm' : 'lg')
  return (
    <Card padding={resolvedPadding} {...cardProps}>
      {children}
    </Card>
  )
}
