import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, Button, Card, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { fortnightlyCents } from '@nest/plan'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import type { BudgetGroup, Frequency } from '../lib/domain'
import { EnumSelect } from './EnumSelect'
import { FortnightlyAmount } from './FortnightlyAmount'

/** The fields a derived-line edit surfaces: the breakdown's name and group, plus the line's funding account. */
export interface DerivedLineValues {
  name: string
  line_group: BudgetGroup
  destination_account_id: string | null
}

interface DerivedBudgetLineFormProps {
  /**
   * The derived line under edit. Its name and group come from the owning
   * breakdown; its funding account and the locked amount/frequency come from the
   * line itself.
   */
  initial: {
    id: string
    breakdown_id: string
    name: string
    line_group: BudgetGroup
    destination_account_id: string | null
    amount_cents: number
    frequency: Frequency
    interval_count: number | null
  }
  /** The household's accounts, offered as the funding destination. */
  accounts?: { id: string; name: string }[]
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
  onSave,
  onCancel,
}: DerivedBudgetLineFormProps) {
  const [name, setName] = useState(initial.name)
  const [group, setGroup] = useState<BudgetGroup>(initial.line_group)
  const [destinationAccountId, setDestinationAccountId] = useState<string | null>(
    initial.destination_account_id,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fortnightly = fortnightlyCents(
    initial.amount_cents,
    initial.frequency,
    initial.interval_count ?? undefined,
  )
  const canSubmit = name.trim() !== '' && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        line_group: group,
        destination_account_id: destinationAccountId,
      })
    } catch {
      setError('Could not save this budget line. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <EnumSelect
          label="Group"
          size="sm"
          data={ACCOUNT_FUNDED_GROUPS}
          value={group}
          onChange={(value) => value && setGroup(value)}
          allowDeselect={false}
        />

        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

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

        <Stack gap={4}>
          <Text component="span" size="sm" fw={500}>
            Amount
          </Text>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <FortnightlyAmount cents={fortnightly} />
            <Anchor
              component={Link}
              to={`/breakdowns/${initial.breakdown_id}`}
              state={{ from: '/budget' }}
              size="sm"
            >
              Edit in breakdown
            </Anchor>
          </Group>
          <Text size="xs" c="dimmed">
            The amount is rolled up from the breakdown's items.
          </Text>
        </Stack>

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
          {onCancel && (
            <Button type="button" variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  )
}
