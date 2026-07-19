import { Stack, Title } from '@mantine/core'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { BudgetLineList } from './BudgetLineList'
import { TemporaryItemList } from './TemporaryItemList'

interface BudgetScreenProps {
  lines: BudgetLine[]
  goals: { id: string; name: string }[]
  temporaryItems: TemporaryItem[]
  /** The household's total planned gift spend, driving any gift-derived line. */
  giftTotalCents: number
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
  goals,
  temporaryItems,
  giftTotalCents,
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
          goals={goals}
          giftTotalCents={giftTotalCents}
          onCreate={onCreateLine}
          onUpdate={onUpdateLine}
          onDelete={(id) => void onDeleteLine(id)}
        />
      </Stack>

      <TemporaryItemList
        items={temporaryItems}
        onCreate={onCreateItem}
        onUpdate={onUpdateItem}
        onDelete={(id) => void onDeleteItem(id)}
      />
    </Stack>
  )
}
