import { useState, type ReactNode } from 'react'
import { Collapse, Group, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { DeductionGroupInput, DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow } from '../hooks/useDeductions'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { formatCents } from '../lib/money'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { FormShell } from './FormShell'

/**
 * Names a recurring deductible expense. A group holds no amount of its own —
 * its total is the sum of the payments filed under it — so the name is the only
 * thing to fill in.
 */
export function DeductionGroupForm({
  member,
  initial,
  onSubmit,
  onCancel,
}: {
  member: { id: string; name: string }
  initial?: DeductionGroupRow | undefined
  onSubmit: (input: DeductionGroupInput) => void | Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const canSubmit = name.trim() !== ''

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this subscription. Please try again.',
    onSubmit,
    buildInput: (): DeductionGroupInput => ({ member_id: member.id, name: name.trim() }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="subscription"
      onCancel={onCancel}
    >
      <TextInput
        label="Subscription"
        size="sm"
        placeholder="e.g. Adobe Creative Cloud"
        description="What the recurring expense is called. Each invoice under it is claimed in its own right; the group totals them."
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
    </FormShell>
  )
}

/**
 * One recurring deductible expense, collapsed to its name, how many payments it
 * has, and their total. Expanding shows the payments — each an ordinary
 * deduction with its own date, amount, and receipts — and the control that
 * appends the next invoice.
 *
 * The total is summed from the payments rather than stored: every payment is a
 * deduction the tax estimate already counts, so a stored group total would be
 * the only figure in the app able to disagree with what is actually claimed.
 */
export function DeductionGroup({
  group,
  payments,
  onEdit,
  onDelete,
  children,
}: {
  group: DeductionGroupRow
  payments: DeductionRow[]
  onEdit: () => void
  onDelete: () => void
  /** The payments list, rendered inside the group when it is expanded. */
  children: ReactNode
}) {
  const [expanded, { toggle }] = useDisclosure(false)
  const bodyId = `deduction-group-${group.id}`

  const totalCents = payments.reduce((total, payment) => total + payment.amount_cents, 0)
  const paymentLabel = payments.length === 1 ? '1 payment' : `${payments.length} payments`

  return (
    <AppCard withBorder padding="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <UnstyledButton
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              <Text fw={600} size="sm" truncate>
                {group.name}
              </Text>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {paymentLabel}
              </Text>
            </Group>
          </UnstyledButton>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Text fw={600} size="sm">
              {formatCents(totalCents)}
            </Text>
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>

        <Collapse expanded={expanded} id={bodyId}>
          <Stack gap={6}>{children}</Stack>
        </Collapse>
      </Stack>
    </AppCard>
  )
}
