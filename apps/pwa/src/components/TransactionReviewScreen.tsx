import { useState, type ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'
import type { ReviewInput } from '../hooks/useTransactionReview'
import {
  categoryGroups,
  REVIEW_PAGE_SIZE,
  type ReviewTransaction,
  type UpCategory,
} from '../lib/transactionReview'
import { EmptyState } from './EmptyState'
import { PageSection } from './PageSection'
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
}

/**
 * The transaction review screen: the member's unreviewed Up transactions,
 * newest first, each confirmed as it stands ("Looks right"), recategorised and
 * annotated ("Save"), or filed as a gift ("It's a gift"), which points on to the
 * Gifts inbox where it waits to be linked. An outflow without a deduction can
 * also become one ("Create deduction"), which opens the Deductions form
 * prefilled from it; one that has a deduction is marked instead. `focused` — the transaction a
 * notification names — leads the list, expanded, even once reviewed.
 */
export function TransactionReviewScreen({
  transactions,
  focused,
  categories,
  accountNames,
  deductedIds,
  onReview,
}: TransactionReviewScreenProps) {
  const [giftFiled, setGiftFiled] = useState(false)
  const groups = categoryGroups(categories)
  const rows: ReviewTransaction[] =
    focused && !transactions.some((transaction) => transaction.id === focused.id)
      ? [focused, ...transactions]
      : transactions

  let content: ReactNode
  if (rows.length === 0) {
    content = <EmptyState>Nothing to review.</EmptyState>
  } else {
    content = (
      <Stack gap="sm">
        {rows.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            categories={categories}
            groups={groups}
            accountName={accountNames[transaction.account_id] ?? null}
            focused={transaction.id === focused?.id}
            deducted={deductedIds?.has(transaction.id) ?? false}
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
      intro="Check each Up transaction's category, fix any that are wrong, and add a note."
    >
      {giftFiled && <GiftFiledAlert onClose={() => setGiftFiled(false)} />}
      {content}
    </PageSection>
  )
}
