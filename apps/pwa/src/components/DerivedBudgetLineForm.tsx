import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { fortnightlyCents } from '@nest/plan'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import type { BudgetGroup, Frequency } from '../lib/domain'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { FortnightlyAmount } from './FortnightlyAmount'

/** The fields a derived-line edit surfaces: the breakdown's name and group, plus the line's funding account. */
export interface DerivedLineValues {
  name: string
  line_group: BudgetGroup
  destination_account_id: string | null
}

interface DerivedBudgetLineFormProps {
  /**
   * The derived line under edit. A generic line's name and group come from the
   * owning breakdown; a gift line's are its own. Its funding account and the locked
   * amount/frequency come from the line itself.
   */
  initial: {
    id: string
    /** The owning generic breakdown, or `null` for a gift line (whose amount is edited in the Gifts tab). */
    breakdown_id: string | null
    name: string
    line_group: BudgetGroup
    destination_account_id: string | null
    amount_cents: number
    frequency: Frequency
    interval_count: number | null
    /**
     * The member whose gifts a gift line funds, or null for the external, generic,
     * and manual lines. When set, the funding account is auto-derived (the buyer's
     * spending account), so the "Funded from" picker locks to a read-only note.
     */
    gift_recipient_member_id: string | null
  }
  /** The household's accounts, offered as the funding destination. */
  accounts?: { id: string; name: string }[]
  /**
   * Whether the name is editable. A generic line's name is its breakdown's own
   * name and edits freely; a gift line's name is partition-derived
   * ("Gifts for <member>"), so it shows read-only. Defaults to editable.
   */
  nameEditable?: boolean
  onSave: (values: DerivedLineValues) => void | Promise<void>
  onCancel?: () => void
}

// A derived line's editor omits the goal-routed groups: those route through a
// goal's saver rather than a funding account, which this editor does not handle.
const ACCOUNT_FUNDED_GROUPS = BUDGET_GROUPS.filter(
  ({ value }) => value !== 'savings' && value !== 'investments',
)

/**
 * Inline editor for a breakdown-sourced ("derived") budget line. Its name and
 * group belong to the owning breakdown (the reconcile pass copies them back onto
 * the line), while the funding account is owned by the line itself; `onSave`
 * surfaces all three together as `DerivedLineValues` and the container fans them
 * out to the breakdown and the line. The amount and frequency are owned by the
 * breakdown's items and shown locked, with a link to the breakdown page to
 * change the itemised total there.
 */
export function DerivedBudgetLineForm({
  initial,
  accounts = [],
  nameEditable = true,
  onSave,
  onCancel,
}: DerivedBudgetLineFormProps) {
  const [name, setName] = useState(initial.name)
  const [group, setGroup] = useState<BudgetGroup>(initial.line_group)
  const [destinationAccountId, setDestinationAccountId] = useState<string | null>(
    initial.destination_account_id,
  )

  // A gift member line funds from the buyer's spending account, set by the
  // reconcile pass rather than the user, so its funding picker locks.
  const fundingLocked = initial.gift_recipient_member_id !== null

  const fortnightly = fortnightlyCents(
    initial.amount_cents,
    initial.frequency,
    initial.interval_count ?? undefined,
  )
  const canSubmit = !nameEditable || name.trim() !== ''

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this budget item. Please try again.',
    onSubmit: onSave,
    buildInput: (): DerivedLineValues => ({
      name: name.trim(),
      line_group: group,
      destination_account_id: destinationAccountId,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing
      onCancel={onCancel}
    >
      <EnumSelect
        label="Group"
        size="sm"
        data={ACCOUNT_FUNDED_GROUPS}
        value={group}
        onChange={(value) => value && setGroup(value)}
        allowDeselect={false}
      />

      {nameEditable ? (
        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      ) : (
        <Stack gap="xxs">
          <Text component="span" size="sm" fw={500}>
            Name
          </Text>
          <Text size="sm">{name}</Text>
        </Stack>
      )}

      {fundingLocked ? (
        <Stack gap="xxs">
          <Text component="span" size="sm" fw={500}>
            Funded from
          </Text>
          <Text size="sm">Automatically from the buyer's spending account.</Text>
        </Stack>
      ) : (
        <Select
          label="Funded from"
          size="sm"
          description="Optional. The account or Up saver whose pay split funds this line."
          placeholder="Not routed"
          data={accounts.map((account) => ({ value: account.id, label: account.name }))}
          value={destinationAccountId}
          onChange={setDestinationAccountId}
          clearable
          searchable
          nothingFoundMessage="No matching accounts"
        />
      )}

      <Stack gap="xxs">
        <Text component="span" size="sm" fw={500}>
          Amount
        </Text>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <FortnightlyAmount cents={fortnightly} />
          <Anchor
            component={Link}
            to={initial.breakdown_id ? `/breakdowns/${initial.breakdown_id}` : '/gifts'}
            state={{ from: '/budget' }}
            size="sm"
          >
            {initial.breakdown_id ? 'Edit in breakdown' : 'Edit in gifts'}
          </Anchor>
        </Group>
        <Text size="xs" c="dimmed">
          {initial.breakdown_id
            ? "The amount is rolled up from the breakdown's items."
            : 'The amount is rolled up from the gift budgets.'}
        </Text>
      </Stack>
    </FormShell>
  )
}
