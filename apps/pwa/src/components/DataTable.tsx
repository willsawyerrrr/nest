import type { ReactNode } from 'react'
import { Table } from '@mantine/core'

/**
 * The app's shared table shell: a horizontally scrollable, compact table with a
 * consistent font size and cell spacing, so every data table reads the same.
 * Callers supply the `Table.Thead` and `Table.Tbody` as children and a label for
 * the table's accessible name. Pass `layout="fixed"` (with column widths on the
 * header cells) when sibling tables must share identical column geometry so their
 * columns line up.
 */
export function DataTable({
  label,
  layout,
  children,
}: {
  label: string
  layout?: 'fixed' | 'auto'
  children: ReactNode
}) {
  return (
    <Table.ScrollContainer minWidth={0}>
      <Table fz="sm" verticalSpacing={4} horizontalSpacing="xs" layout={layout} aria-label={label}>
        {children}
      </Table>
    </Table.ScrollContainer>
  )
}
