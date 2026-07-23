import type { ReactNode } from 'react'
import { Table } from '@mantine/core'

/**
 * The app's shared table shell: a horizontally scrollable, compact table with a
 * consistent font size and cell spacing, so every data table reads the same.
 * Callers supply the `Table.Thead` and `Table.Tbody` as children and a label for
 * the table's accessible name.
 */
export function DataTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table.ScrollContainer minWidth={0}>
      <Table fz="sm" verticalSpacing={4} horizontalSpacing="xs" aria-label={label}>
        {children}
      </Table>
    </Table.ScrollContainer>
  )
}
