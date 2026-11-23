import { useState } from 'react'
import { Button, Group, Select, SimpleGrid, Stack } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { Member } from '../hooks/useMembers'
import type { ReviewInput } from '../hooks/useTransactionReview'
import {
  categoryFilterOptions,
  hasTransactionFilters,
  transactionAttribution,
  type TransactionFilters,
} from '../lib/transactionList'
import { categoryGroups, type ReviewTransaction, type UpCategory } from '../lib/transactionReview'
import { EmptyState } from './EmptyState'
import { PageSection } from './PageSection'
import { GiftFiledAlert, TransactionRow } from './TransactionRow'

interface TransactionListScreenProps {
  /** The loaded transactions matching `filters`, newest first. */
  transactions: ReviewTransaction[]
  categories: UpCategory[]
  /** Account names by id, in the order the account filter lists them. */
  accountNames: Readonly<Record<string, string>>
  members: Member[]
  /** The ids of the transactions that already have a deduction. */
  deductedIds?: ReadonlySet<string>
  filters: TransactionFilters
  onFiltersChange: (filters: TransactionFilters) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onReview: (transactionId: string, input: ReviewInput) => Promise<void>
}

const NO_FILTERS: TransactionFilters = {
  account: null,
  from: null,
  to: null,
  kind: null,
  status: null,
  category: null,
}

const KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'settled', label: 'Settled' },
]

/**
 * The transactions screen: every transaction the member can see, newest first,
 * filtered by account, date range, kind, status, and Up category, with a
 * "Load more" for older pages. Each row names whose it is and expands to the
 * same review form as the review screen.
 */
export function TransactionListScreen({
  transactions,
  categories,
  accountNames,
  members,
  deductedIds,
  filters,
  onFiltersChange,
  hasMore,
  loadingMore,
  onLoadMore,
  onReview,
}: TransactionListScreenProps) {
  const [giftFiled, setGiftFiled] = useState(false)
  const groups = categoryGroups(categories)
  const filtered = hasTransactionFilters(filters)
  const set = (change: Partial<TransactionFilters>) => onFiltersChange({ ...filters, ...change })

  return (
    <PageSection
      title="Transactions"
      intro="Every transaction on the accounts you can see. Open one to check its category or add a note."
    >
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
        <Select
          label="Account"
          placeholder="All accounts"
          size="sm"
          data={Object.entries(accountNames).map(([value, label]) => ({ value, label }))}
          value={filters.account}
          onChange={(account) => set({ account })}
          clearable
          searchable
        />
        <DateInput
          label="From"
          placeholder="Any date"
          size="sm"
          valueFormat="D MMM YYYY"
          value={filters.from}
          onChange={(from) => set({ from })}
          clearable
        />
        <DateInput
          label="To"
          placeholder="Any date"
          size="sm"
          valueFormat="D MMM YYYY"
          value={filters.to}
          onChange={(to) => set({ to })}
          clearable
        />
        <Select
          label="Kind"
          placeholder="All kinds"
          size="sm"
          data={KIND_OPTIONS}
          value={filters.kind}
          onChange={(kind) => set({ kind: kind as TransactionFilters['kind'] })}
          clearable
        />
        <Select
          label="Status"
          placeholder="Any status"
          size="sm"
          data={STATUS_OPTIONS}
          value={filters.status}
          onChange={(status) => set({ status: status as TransactionFilters['status'] })}
          clearable
        />
        <Select
          label="Category"
          placeholder="All categories"
          size="sm"
          data={categoryFilterOptions(categories)}
          value={filters.category}
          onChange={(category) => set({ category })}
          clearable
          searchable
        />
      </SimpleGrid>
      {filtered && (
        <Group>
          <Button size="xs" variant="subtle" onClick={() => onFiltersChange(NO_FILTERS)}>
            Clear filters
          </Button>
        </Group>
      )}
      {giftFiled && <GiftFiledAlert onClose={() => setGiftFiled(false)} />}
      {transactions.length === 0 ? (
        <EmptyState>
          {filtered ? 'No transactions match these filters.' : 'No transactions yet.'}
        </EmptyState>
      ) : (
        <Stack gap="sm">
          {transactions.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              transaction={transaction}
              categories={categories}
              groups={groups}
              accountName={accountNames[transaction.account_id] ?? null}
              attribution={transactionAttribution(members, transaction)}
              deducted={deductedIds?.has(transaction.id) ?? false}
              onReview={onReview}
              onGiftFiled={() => setGiftFiled(true)}
            />
          ))}
          {hasMore && (
            <Group justify="center">
              <Button variant="default" size="sm" loading={loadingMore} onClick={onLoadMore}>
                Load more
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </PageSection>
  )
}
