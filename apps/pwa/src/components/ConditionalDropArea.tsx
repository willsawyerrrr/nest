import type { ReactNode } from 'react'
import { FileDropArea } from './FileDropArea'

/** Wraps `children` in a drop area while `enabled`, else leaves them as they are. */
export function ConditionalDropArea({
  enabled,
  onFiles,
  children,
}: {
  enabled: boolean
  onFiles: (files: File[]) => void
  children: ReactNode
}) {
  return enabled ? <FileDropArea onFiles={onFiles}>{children}</FileDropArea> : <>{children}</>
}
