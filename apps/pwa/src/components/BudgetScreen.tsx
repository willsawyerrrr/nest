import { Stack, Text } from '@mantine/core'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import type { BudgetGroup } from '../lib/domain'
import type { PromoteDraft } from '../lib/promoteDraft'
import { BudgetLineForm } from './BudgetLineForm'
import { BudgetLineList } from './BudgetLineList'
import type { DerivedLineValues } from './DerivedBudgetLineForm'
import { PageSection } from './PageSection'
import { TemporaryItemList } from './TemporaryItemList'

interface BudgetScreenProps {
  lines: BudgetLine[]
  goals: { id: string; name: string; linkedAccountId?: string | null }[]
  accounts: { id: string; name: string }[]
  /** The household's generic breakdowns, naming the tap-through link on each derived line and seeding its editor. */
  breakdowns: { id: string; name: string; line_group: BudgetGroup }[]
  temporaryItems: TemporaryItem[]
  onCreateLine: (input: BudgetLineInput) => Promise<void>
  onUpdateLine: (id: string, input: BudgetLineInput) => Promise<void>
  /**
   * Saves a derived line's edit, fanning the name/group to its breakdown and the
   * funding account to the line. Omitted in planning mode, where a derived line —
   * whose edit writes real breakdown/gift data — is read-only.
   */
  onUpdateDerivedLine?: ((lineId: string, values: DerivedLineValues) => Promise<void>) | undefined
  onDeleteLine: (id: string) => Promise<void>
  onCreateItem: (input: TemporaryItemInput) => Promise<void>
  onUpdateItem: (id: string, input: TemporaryItemInput) => Promise<void>
  onDeleteItem: (id: string) => Promise<void>
  /** A wishlist item promoted to a budget line: opens a prefilled add form above the list. */
  promoteDraft?: PromoteDraft | null
  /** Called once the promoted draft has been saved or dismissed, to clear it. */
  onPromoteConsumed?: () => void
}

/** Presentational budget-line + temporary-item management. Persistence lives in the caller. */
export function BudgetScreen({
  lines,
  goals,
  accounts,
  breakdowns,
  temporaryItems,
  onCreateLine,
  onUpdateLine,
  onUpdateDerivedLine,
  onDeleteLine,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  promoteDraft,
  onPromoteConsumed,
}: BudgetScreenProps) {
  return (
    <PageSection title="Budget">
      {promoteDraft && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            New budget item from your wishlist item “{promoteDraft.name}”. Pick a frequency for the
            amount, adjust, and save it — or cancel to leave the wishlist item as it is.
          </Text>
          <BudgetLineForm
            draft={promoteDraft}
            defaultGroup="discretionary"
            goals={goals}
            accounts={accounts}
            onSubmit={async (input) => {
              await onCreateLine(input)
              onPromoteConsumed?.()
            }}
            onCancel={() => onPromoteConsumed?.()}
          />
        </Stack>
      )}
      <BudgetLineList
        lines={lines}
        goals={goals}
        accounts={accounts}
        breakdowns={breakdowns}
        onCreate={onCreateLine}
        onUpdate={onUpdateLine}
        onUpdateDerivedLine={onUpdateDerivedLine}
        onDelete={(id) => void onDeleteLine(id)}
      />
      <TemporaryItemList
        items={temporaryItems}
        onCreate={onCreateItem}
        onUpdate={onUpdateItem}
        onDelete={(id) => void onDeleteItem(id)}
      />
    </PageSection>
  )
}
