import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import type { BudgetGroup } from '../lib/domain'
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
  /** Saves a derived line's edit, fanning the name/group to its breakdown and the funding account to the line. */
  onUpdateDerivedLine: (lineId: string, values: DerivedLineValues) => Promise<void>
  onDeleteLine: (id: string) => Promise<void>
  onCreateItem: (input: TemporaryItemInput) => Promise<void>
  onUpdateItem: (id: string, input: TemporaryItemInput) => Promise<void>
  onDeleteItem: (id: string) => Promise<void>
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
}: BudgetScreenProps) {
  return (
    <PageSection title="Budget">
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
