import { useState, type ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'
import type { BulkOutcome, ReviewInput } from '../hooks/useTransactionReview'
import { GIFT_TRANSACTION_CATEGORY } from '../lib/giftCandidates'
import {
  categoryGroups,
  REVIEW_PAGE_SIZE,
  transactionLabel,
  type ReviewTransaction,
  type UpCategory,
} from '../lib/transactionReview'
import { EmptyState } from './EmptyState'
import { PageSection } from './PageSection'
import { BulkBar, BulkFailureAlert, type BulkFailure } from './TransactionReviewBulk'
import { GiftFiledAlert, TransactionRow } from './TransactionRow'

interface TransactionReviewScreenProps {
  /** The unreviewed transactions, newest first. */
  transactions: ReviewTransaction[]
  /** The transaction `?id=` names, shown first and expanded, reviewed or not. */
  focused: ReviewTransaction | null
  categories: UpCategory[]
  /** Account names by id. */
  accountNames: Readonly<Record<string, string>>
  /** The ids of the transactions that already have a deduction. */
  deductedIds?: ReadonlySet<string>
  onReview: (transactionId: string, input: ReviewInput) => Promise<void>
  /** Marks the transactions reviewed as they stand. */
  onReviewMany: (transactionIds: readonly string[]) => Promise<BulkOutcome>
  /** Sets one Up category on the transactions and marks them reviewed. */
  onCategoriseMany: (
    transactionIds: readonly string[],
    categoryId: string | null,
  ) => Promise<BulkOutcome>
}

/**
 * The transaction review screen: the member's unreviewed Up transactions,
 * newest first, each confirmed as it stands ("Looks right"), recategorised and
 * annotated ("Save"), or filed as a gift ("It's a gift"), which points on to the
 * Gifts inbox where it waits to be linked. An outflow without a deduction can
 * also become one ("Create deduction"), which opens the Deductions form
 * prefilled from it; one that has a deduction is marked instead. `focused` — the transaction a
 * notification names — leads the list, expanded, even once reviewed.
 *
 * Unreviewed rows can be selected, one by one or all at once, and the selection
 * marked reviewed or given one category together. A transaction a bulk action
 * could not save stays selected and waiting, and the screen names it and why.
 */
export function TransactionReviewScreen({
  transactions,
  focused,
  categories,
  accountNames,
  deductedIds,
  onReview,
  onReviewMany,
  onCategoriseMany,
}: TransactionReviewScreenProps) {
  const [giftFiled, setGiftFiled] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<'review' | 'categorise' | null>(null)
  const [bulkFailure, setBulkFailure] = useState<BulkFailure | null>(null)
  const groups = categoryGroups(categories)
  const rows: ReviewTransaction[] =
    focused && !transactions.some((transaction) => transaction.id === focused.id)
      ? [focused, ...transactions]
      : transactions
  const selectable = rows.filter((transaction) => transaction.reviewed_at === null)
  // Rows that leave the list (reviewed elsewhere, or by this action) leave the selection.
  const selected = selectable.filter((transaction) => selectedIds.has(transaction.id))

  function select(id: string, on: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (on) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  async function runBulk(action: 'review' | 'categorise', categoryId?: string) {
    const ids = selected.map((transaction) => transaction.id)
    const labels = new Map(
      selected.map((transaction) => [transaction.id, transactionLabel(transaction)]),
    )
    setBusy(action)
    setBulkFailure(null)
    try {
      const { failed } =
        action === 'review'
          ? await onReviewMany(ids)
          : await onCategoriseMany(ids, categoryId ?? null)
      setSelectedIds(new Set(failed.map(({ id }) => id)))
      setBulkFailure(
        failed.length > 0
          ? failed.map(({ id, code }) => ({ label: labels.get(id) ?? 'Card purchase', code }))
          : null,
      )
      if (categoryId === GIFT_TRANSACTION_CATEGORY && failed.length < ids.length) {
        setGiftFiled(true)
      }
    } catch {
      setBulkFailure(ids.map((id) => ({ label: labels.get(id) ?? 'Card purchase', code: null })))
    } finally {
      setBusy(null)
    }
  }

  let content: ReactNode
  if (rows.length === 0) {
    content = <EmptyState>Nothing to review.</EmptyState>
  } else {
    content = (
      <Stack gap="sm">
        {selectable.length > 0 && (
          <BulkBar
            selectable={selectable.length}
            selectedCount={selected.length}
            groups={groups}
            busy={busy}
            onSelectAll={(on) =>
              setSelectedIds(new Set(on ? selectable.map((transaction) => transaction.id) : []))
            }
            onReviewMany={() => void runBulk('review')}
            onCategoriseMany={(categoryId) => void runBulk('categorise', categoryId)}
          />
        )}
        {rows.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            categories={categories}
            groups={groups}
            accountName={accountNames[transaction.account_id] ?? null}
            focused={transaction.id === focused?.id}
            deducted={deductedIds?.has(transaction.id) ?? false}
            selected={
              transaction.reviewed_at === null ? selectedIds.has(transaction.id) : undefined
            }
            onSelect={(on) => select(transaction.id, on)}
            onReview={onReview}
            onGiftFiled={() => setGiftFiled(true)}
          />
        ))}
        {transactions.length >= REVIEW_PAGE_SIZE && (
          <Text size="xs" c="dimmed">
            Showing the newest {REVIEW_PAGE_SIZE}. Older ones appear as these are reviewed.
          </Text>
        )}
      </Stack>
    )
  }

  return (
    <PageSection
      title="Review transactions"
      intro="Check each Up transaction's category, fix any that are wrong, and add a note. Select several to review them together."
    >
      {bulkFailure && (
        <BulkFailureAlert failure={bulkFailure} onClose={() => setBulkFailure(null)} />
      )}
      {giftFiled && <GiftFiledAlert onClose={() => setGiftFiled(false)} />}
      {content}
    </PageSection>
  )
}
