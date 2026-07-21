import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'
import { fortnightlyCents } from '@nest/plan'
import type { Breakdown, BreakdownInput } from '../hooks/useBreakdowns'
import type { BudgetGroup } from '../lib/domain'
import { BUDGET_GROUPS, groupLabel } from '../lib/budgetGroups'
import { formatPerYear } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { FortnightlyAmount } from './FortnightlyAmount'

interface BreakdownsScreenProps {
  breakdowns: Breakdown[]
  /** Each breakdown's rolled-up annual total in cents, keyed by breakdown id. */
  totalsByBreakdownId: Map<string, number>
  onCreate: (input: BreakdownInput) => Promise<void>
}

/** Add form for a new generic breakdown: a name and a budget group. */
function NewBreakdownForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: BreakdownInput) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState<BudgetGroup>('needs')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), line_group: group, kind: 'generic' })
    } catch {
      setError('Could not create this breakdown. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <EnumSelect
          label="Group"
          size="sm"
          description="The budget group the rolled-up line belongs to."
          data={BUDGET_GROUPS}
          value={group}
          onChange={(value) => value && setGroup(value)}
          allowDeselect={false}
        />
        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}
        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : 'Add breakdown'}
          </Button>
          <Button type="button" variant="default" onClick={onCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

/** One breakdown row: its name, group, and rolled-up totals, linking to its editor. */
function BreakdownRow({ breakdown, annualCents }: { breakdown: Breakdown; annualCents: number }) {
  const fortnightly = fortnightlyCents(annualCents, 'annual')
  return (
    <UnstyledButton component={Link} to={`/breakdowns/${breakdown.id}`}>
      <Card withBorder radius="md" p="sm">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              {breakdown.name}
            </Text>
            <Badge size="xs" variant="light">
              {groupLabel(breakdown.line_group)}
            </Badge>
          </Stack>
          <Group gap="xs" wrap="nowrap" align="baseline" style={{ flexShrink: 0 }}>
            <Stack gap={0} align="flex-end">
              <FortnightlyAmount cents={fortnightly} />
              <Text size="xs" c="dimmed">
                {formatPerYear(annualCents)}
              </Text>
            </Stack>
            <IconChevronRight size={16} />
          </Group>
        </Group>
      </Card>
    </UnstyledButton>
  )
}

/** Presentational list of the household's breakdowns with a new-breakdown affordance. */
export function BreakdownsScreen({
  breakdowns,
  totalsByBreakdownId,
  onCreate,
}: BreakdownsScreenProps) {
  const [adding, setAdding] = useState(false)

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2} visibleFrom="sm">
          Breakdowns
        </Title>
        {!adding && <Button onClick={() => setAdding(true)}>New breakdown</Button>}
      </Group>

      <Text c="dimmed" size="sm">
        A breakdown is an itemised list whose items roll up into a single budget line.
      </Text>

      {adding && (
        <NewBreakdownForm
          onSubmit={async (input) => {
            await onCreate(input)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {breakdowns.length === 0 && !adding ? (
        <Text c="dimmed" size="sm">
          No breakdowns yet.
        </Text>
      ) : (
        breakdowns.map((breakdown) => (
          <BreakdownRow
            key={breakdown.id}
            breakdown={breakdown}
            annualCents={totalsByBreakdownId.get(breakdown.id) ?? 0}
          />
        ))
      )}
    </Stack>
  )
}
