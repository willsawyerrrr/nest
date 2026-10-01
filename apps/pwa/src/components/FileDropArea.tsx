import { useState, type DragEvent, type ReactNode } from 'react'
import { Box } from '@mantine/core'

interface FileDropAreaProps {
  /** Receives the files dropped on the area. */
  onFiles: (files: File[]) => void
  children: ReactNode
}

/** Whether a drag carries files, as opposed to text or a link being dragged around the page. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

/**
 * A region files can be dropped on, outlined while a file is dragged over it.
 * Touch devices have no drag-and-drop, so whatever it wraps must also offer a
 * file picker.
 */
export function FileDropArea({ onFiles, children }: FileDropAreaProps) {
  const [over, setOver] = useState(false)

  return (
    <Box
      role="group"
      aria-label="Drop files here"
      p="xs"
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false)
        }
      }}
      onDrop={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault()
          setOver(false)
          onFiles([...event.dataTransfer.files])
        }
      }}
      style={{
        border: `1px dashed var(${over ? '--mantine-color-brand-5' : '--mantine-color-default-border'})`,
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      {children}
    </Box>
  )
}
