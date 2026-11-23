import { useEffect, useRef, useState } from 'react'
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
import type { ReviewInput } from '../hooks/useTransactionReview'
import { formatIsoDate, isoDate } from '../lib/dates'
import { GIFT_TRANSACTION_CATEGORY } from '../lib/giftCandidates'
import { createDeductionPath, isOutflow } from '../lib/transactionDeduction'
import {
  categoryLabel,
  isGift,
  ReviewError,
  reviewErrorMessage,
  reviewErrorNeedsConnections,
  transactionLabel,
  type CategoryGroup,
  type ReviewTransaction,
  type UpCategory,
} from '../lib/transactionReview'
import { AppCard } from './AppCard'
import { FormError } from './FormError'
import { MoneyText } from './MoneyText'

/** Saves a review of a transaction; rejects with a {@link ReviewError}. */
type OnReview = (transactionId: string, input: ReviewInput) => Promise<void>

/** Which action is saving, so only its button shows progress. */
type Action = 'confirm' | 'save' | 'gift'

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
  onReview: OnReview
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
 * One transaction: a header summarising it — description, pending, transfer,
 * reviewed and deduction pills, who it belongs to when `attribution` is given,
 * account and date, Up's category and its words, the signed
 * amount — that expands to the review form, beside an "Open in Up" link that
 * stays outside the disclosure. Up exposes no cover data, so the link is how a
 * cover is fixed. Wide screens render a dense row, narrow ones a compact card.
 * A `focused` row starts expanded and scrolls into view.
 */
export function TransactionRow({
  transaction,
  categories,
  groups,
  accountName,
  attribution,
  focused = false,
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
  /** Whose transaction it is (a member's name, or `Joint`); omitted to show none. */
  attribution?: string
  focused?: boolean
  deducted: boolean
  /** Whether the row is selected for a bulk action; undefined when it cannot be (already reviewed). */
  selected?: boolean | undefined
  onSelect?: (selected: boolean) => void
  onReview: OnReview
  onGiftFiled: () => void
}) {
  const wide = useIsWide()
  const [opened, setOpened] = useState(focused)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyId = `transaction-${transaction.id}`

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
          onChange={(event) => onSelect?.(event.currentTarget.checked)}
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
              {transaction.kind === 'transfer' && (
                <Badge size="xs" color="gray" variant="light" style={{ flexShrink: 0 }}>
                  Transfer
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
            <Group gap="xxs" wrap="nowrap" style={{ minWidth: 0 }}>
              {attribution && (
                <Badge size="xs" color="gray" variant="outline" style={{ flexShrink: 0 }}>
                  {attribution}
                </Badge>
              )}
              <Text size="xs" c="dimmed" truncate>
                {meta}
              </Text>
            </Group>
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
    <Box ref={rootRef} data-testid="transaction-row">
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

/** The notice after a transaction is filed as a gift, pointing on to the Gifts inbox. */
export function GiftFiledAlert({ onClose }: { onClose: () => void }) {
  return (
    <Alert color="info" variant="light" p="xs" withCloseButton onClose={onClose}>
      <Text size="sm">
        Filed as a gift. Link it to a recipient from the Gifts inbox.{' '}
        <Anchor component={Link} to="/gifts" size="sm">
          Open Gifts
        </Anchor>
      </Text>
    </Alert>
  )
}
