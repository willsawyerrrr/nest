import { Stack, Title } from '@mantine/core'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { BudgetLineList } from './BudgetLineList'
import { TemporaryItemList } from './TemporaryItemList'

interface BudgetScreenProps {
  lines: BudgetLine[]
  temporaryItems: TemporaryItem[]
  onCreateLine: (input: BudgetLineInput) => Promise<void>
  onUpdateLine: (id: string, input: BudgetLineInput) => Promise<void>
  onDeleteLine: (id: string) => Promise<void>
  onCreateItem: (input: TemporaryItemInput) => Promise<void>
  onUpdateItem: (id: string, input: TemporaryItemInput) => Promise<void>
  onDeleteItem: (id: string) => Promise<void>
}

/** Presentational budget-line + temporary-item management. Persistence lives in the caller. */
export function BudgetScreen({
  lines,
  temporaryItems,
  onCreateLine,
  onUpdateLine,
  onDeleteLine,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
}: BudgetScreenProps) {
  return (
    <Stack gap="xl">
      <Stack gap="md">
        <Title order={2}>Budget</Title>
        <BudgetLineList
          lines={lines}
          onCreate={onCreateLine}
          onUpdate={onUpdateLine}
          onDelete={(id) => void onDeleteLine(id)}
        />
      </Stack>

      <Stack gap="md">
        <Title order={2}>Temporary items</Title>
        <TemporaryItemList
          items={temporaryItems}
          onCreate={onCreateItem}
          onUpdate={onUpdateItem}
          onDelete={(id) => void onDeleteItem(id)}
        />
      </Stack>
    </Stack>
  )
}
