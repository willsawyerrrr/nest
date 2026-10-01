import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'

/**
 * A region deductions can be dropped on. While a deduction is dragged and the
 * region is a valid target for it, the region is outlined, and filled while the
 * deduction is over it.
 */
export function DropTarget({
  id,
  valid,
  dragging,
  children,
}: {
  id: string
  valid: boolean
  dragging: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !valid })
  const highlighted = dragging && valid
  return (
    <div
      ref={setNodeRef}
      data-drop-target={highlighted ? 'valid' : undefined}
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        outline: highlighted ? '2px dashed var(--mantine-primary-color-filled)' : undefined,
        outlineOffset: 2,
        background: highlighted && isOver ? 'var(--mantine-primary-color-light)' : undefined,
      }}
    >
      {children}
    </div>
  )
}
