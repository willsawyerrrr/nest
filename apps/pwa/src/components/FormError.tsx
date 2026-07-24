import type { ReactNode } from 'react'
import { Text } from '@mantine/core'

interface FormErrorProps {
  /** The failure message to announce. */
  children: ReactNode
}

/** The inline error message shown when a form action fails, announced to assistive tech. */
export function FormError({ children }: FormErrorProps) {
  return (
    <Text role="alert" c="negative" size="sm">
      {children}
    </Text>
  )
}
