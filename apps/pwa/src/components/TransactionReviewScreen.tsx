import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core'
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconGift,
  IconReceiptTax,
} from '@tabler/icons-react'
import { useIsWide } from '../hooks/useIsWide'
import type { BulkOutcome, ReviewInput } from '../hooks/useTransactionReview'
import { formatIsoDate, isoDate } from '../lib/dates'
import { GIFT_TRANSACTION_CATEGORY } from '../lib/giftCandidates'
import { createDeductionPath, isOutflow } from '../lib/transactionDeduction'
import {
  categoryGroups,
  categoryLabel,
  isGift,
  REVIEW_PAGE_SIZE,
  ReviewError,
  reviewErrorMessage,
  reviewErrorNeedsConnections,
  type CategoryGroup,
  type ReviewTransaction,
  type UpCategory,
} from '../lib/transactionReview'
import { AppCard } from './AppCard'
import { EmptyState } from './EmptyState'
import { FormError } from './FormError'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { BulkBar, BulkFailureAlert, type BulkFailure } from './TransactionReviewBulk'

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

/** Which action is saving, so only its button shows progress. */
type Action = 'confirm' | 'save' | 'gift'

/** A transaction's own words, falling back to a generic label for an unnamed one. */
function transactionLabel(transaction: ReviewTransaction): string {
  return transaction.description || 'Card purchase'
}

/** The failure line for a review action, linking to Connections where the fix is there. */
function ReviewFailure({ code }: { code: string | null }) {
  return (
    <FormError>
      {reviewErrorMessage(code)}
      {reviewErrorNeedsConnections(code) && (
        <>
          {' '}
          <Anchor component={Link} to="/settings/connections" size="sm">
            Open Connections
          </Anchor>
        </>
      )}
    </FormError>
  )
}

/** Up's own note and message, read-only: Up's API cannot write either. */
function UpWords({ transaction }: { transaction: ReviewTransaction }) {
  if (!transaction.up_note && !transaction.up_message) {
    return null
  }
  return (
    <Stack gap={0}>
      {transaction.up_note && (
        <Text size="xs" c="dimmed">
          Up note: {transaction.up_note}
        </Text>
      )}
      {transaction.up_message && (
        <Text size="xs" c="dimmed">
          Up message: {transaction.up_message}
        </Text>
      )}
    </Stack>
  )
}

/** The editor under an expanded row: category, Nest note, and the review actions. */
function ReviewForm({
  transaction,
  groups,
  deducted,
  onReview,
  onGiftFiled,
}: {
  transaction: ReviewTransaction
  groups: CategoryGroup[]
  deducted: boolean
  onReview: TransactionReviewScreenProps['onReview']
  onGiftFiled: () => void
}) {
  const [categoryId, setCategoryId] = useState(transaction.external_category)
  const [note, setNote] = useState(transaction.notes ?? '')
  const [saving, setSaving] = useState<Action | null>(null)
  const [failure, setFailure] = useState<{ code: string | null } | null>(null)

  const categorisable = transaction.is_categorizable === true
  const categoryChanged = categoryId !== transaction.external_category
  const noteChanged = note.trim() !== (transaction.notes ?? '')

  async function run(action: Action, input: ReviewInput) {
    setSaving(action)
    setFailure(null)
    try {
      await onReview(transaction.id, input)
      if (action === 'gift') {
        onGiftFiled()
      }
    } catch (error) {
      setFailure({ code: error instanceof ReviewError ? error.code : null })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Stack gap="sm" pt="xs">
      <Select
        label="Category"
        placeholder="Uncategorised"
        data={groups}
        value={categoryId}
        onChange={setCategoryId}
        searchable
        clearable
        disabled={!categorisable}
        description={categorisable ? undefined : 'Up does not let this transaction be categorised.'}
      />
      <Textarea
        label="Nest note"
        placeholder="Only your household sees this"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
      {failure && <ReviewFailure code={failure.code} />}
      <Group gap="xs">
        <Button
          size="xs"
          disabled={!categoryChanged && !noteChanged}
          loading={saving === 'save'}
          onClick={() => void run('save', categoryChanged ? { note, categoryId } : { note })}
        >
          Save
        </Button>
        <Button
          size="xs"
          variant="light"
          disabled={categoryChanged}
          loading={saving === 'confirm'}
          onClick={() => void run('confirm', { note })}
        >
          Looks right
        </Button>
        {categorisable && !isGift(transaction) && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconGift size={14} />}
            loading={saving === 'gift'}
            onClick={() => void run('gift', { note, categoryId: GIFT_TRANSACTION_CATEGORY })}
          >
            It&apos;s a gift
          </Button>
        )}
        {isOutflow(transaction) && !deducted && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconReceiptTax size={14} />}
            component={Link}
            to={createDeductionPath(transaction.id)}
          >
            Create deduction
          </Button>
        )}
      </Group>
    </Stack>
  )
}

/**
 * One transaction: a header summarising it — description, pending and
 * reviewed pills, account and date, Up's category and its words, the signed
 * amount — that expands to the review form, beside an "Open in Up" link that
 * stays outside the disclosure. Up exposes no cover data, so the link is how a
 * cover is fixed. Wide screens render a dense row, narrow ones a compact card.
 */
function ReviewRow({
  transaction,
  categories,
  groups,
  accountName,
  focused,
  deducted,
  selected,
  onSelect,
  onReview,
  onGiftFiled,
}: {
  transaction: ReviewTransaction
  categories: UpCategory[]
  groups: CategoryGroup[]
  accountName: string | null
  focused: boolean
  deducted: boolean
  /** Whether the row is selected for a bulk action; undefined when it cannot be (already reviewed). */
  selected: boolean | undefined
  onSelect: (selected: boolean) => void
  onReview: TransactionReviewScreenProps['onReview']
  onGiftFiled: () => void
}) {
  const wide = useIsWide()
  const [opened, setOpened] = useState(focused)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyId = `transaction-review-${transaction.id}`

  useEffect(() => {
    if (focused) {
      rootRef.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [focused])

  const category = categoryLabel(categories, transaction.external_category)
  const meta = [accountName, formatIsoDate(isoDate(new Date(transaction.posted_at)))]
    .filter(Boolean)
    .join(' · ')

  const header = (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      {selected !== undefined && (
        <Checkbox
          pt={2}
          size="xs"
          checked={selected}
          onChange={(event) => onSelect(event.currentTarget.checked)}
          aria-label={`Select ${transactionLabel(transaction)}`}
          style={{ flexShrink: 0 }}
        />
      )}
      <UnstyledButton
        onClick={() => setOpened((open) => !open)}
        aria-expanded={opened}
        aria-controls={bodyId}
        style={{ flex: 1, minWidth: 0 }}
      >
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Box pt={2} style={{ flexShrink: 0 }}>
            {opened ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </Box>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xxs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate style={{ minWidth: 0 }}>
                {transactionLabel(transaction)}
              </Text>
              {transaction.status === 'pending' && (
                <Badge size="xs" color="warning" style={{ flexShrink: 0 }}>
                  Pending
                </Badge>
              )}
              {transaction.reviewed_at && (
                <Badge size="xs" color="positive" style={{ flexShrink: 0 }}>
                  Reviewed
                </Badge>
              )}
              {deducted && (
                <Badge size="xs" color="info" style={{ flexShrink: 0 }}>
                  Deduction
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" truncate>
              {meta}
            </Text>
            <Text size="xs" truncate>
              {category ?? 'Uncategorised'}
            </Text>
            <UpWords transaction={transaction} />
          </Stack>
          <MoneyText
            cents={transaction.amount_cents}
            colored
            size="sm"
            fw={600}
            ta="right"
            style={{ flexShrink: 0, minWidth: '5.5rem' }}
          />
        </Group>
      </UnstyledButton>
      {transaction.deep_link_url && (
        <ActionIcon
          component="a"
          href={transaction.deep_link_url}
          target="_blank"
          rel="noopener noreferrer"
          color="gray"
          aria-label="Open in Up"
          title="Open in Up"
          style={{ flexShrink: 0 }}
        >
          <IconExternalLink size={16} />
        </ActionIcon>
      )}
    </Group>
  )

  const body = (
    <Collapse expanded={opened} id={bodyId}>
      {opened && (
        <ReviewForm
          transaction={transaction}
          groups={groups}
          deducted={deducted}
          onReview={onReview}
          onGiftFiled={onGiftFiled}
        />
      )}
    </Collapse>
  )

  return (
    <Box ref={rootRef} data-testid="transaction-review-row">
      {wide ? (
        <Box py={6} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          {header}
          {body}
        </Box>
      ) : (
        <AppCard density="compact">
          {header}
          {body}
        </AppCard>
      )}
    </Box>
  )
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
          <ReviewRow
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
      {giftFiled && (
        <Alert
          color="info"
          variant="light"
          p="xs"
          withCloseButton
          onClose={() => setGiftFiled(false)}
        >
          <Text size="sm">
            Filed as a gift. Link it to a recipient from the Gifts inbox.{' '}
            <Anchor component={Link} to="/gifts" size="sm">
              Open Gifts
            </Anchor>
          </Text>
        </Alert>
      )}
      {content}
    </PageSection>
  )
}
