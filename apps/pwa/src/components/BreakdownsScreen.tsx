import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Group, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconChevronRight } from '@tabler/icons-react'
import { fortnightlyCents } from '@nest/plan'
import type { Breakdown, BreakdownInput } from '../hooks/useBreakdowns'
import { BUDGET_GROUPS, groupLabel } from '../lib/budgetGroups'
import type { BudgetGroup } from '../lib/domain'
import { formatPerYear } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EmptyState } from './EmptyState'
import { EnumSelect } from './EnumSelect'
import { FortnightlyAmount } from './FortnightlyAmount'
import { ListRow } from './ListRow'
import { PageSection } from './PageSection'

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
    <AppCard withBorder padding="sm" component="form" onSubmit={handleSubmit}>
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
    </AppCard>
  )
}

interface BreakdownItemProps {
  breakdown: Breakdown
  annualCents: number
}

/**
 * One breakdown as a dense table-like row for desktop: the name grows with its
 * group badge beside it, then its fortnightly and annual rollups right-aligned in
 * fixed columns and a chevron, the whole row linking to its editor.
 */
function BreakdownRow({ breakdown, annualCents }: BreakdownItemProps) {
  const fortnightly = fortnightlyCents(annualCents, 'annual')
  return (
    <UnstyledButton component={Link} to={`/breakdowns/${breakdown.id}`} display="block">
      <ListRow gap="sm">
        <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {breakdown.name}
          </Text>
          <Badge size="xs" variant="light">
            {groupLabel(breakdown.line_group)}
          </Badge>
        </Group>
        <FortnightlyAmount
          cents={fortnightly}
          justify="flex-end"
          style={{ width: '7rem', flexShrink: 0 }}
        />
        <Text size="xs" c="dimmed" ta="right" style={{ width: '8rem', flexShrink: 0 }}>
          {formatPerYear(annualCents)}
        </Text>
        <IconChevronRight size={16} />
      </ListRow>
    </UnstyledButton>
  )
}

/** One breakdown as a compact bordered card for mobile, linking to its editor. */
function BreakdownCard({ breakdown, annualCents }: BreakdownItemProps) {
  const fortnightly = fortnightlyCents(annualCents, 'annual')
  return (
    <UnstyledButton component={Link} to={`/breakdowns/${breakdown.id}`}>
      <AppCard withBorder padding="sm">
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
      </AppCard>
    </UnstyledButton>
  )
}

/**
 * A single breakdown, rendered as a dense table-like row from the `sm` breakpoint
 * up and as a compact bordered card below it.
 */
function BreakdownItem(props: BreakdownItemProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <BreakdownRow {...props} /> : <BreakdownCard {...props} />
}

/** Presentational list of the household's breakdowns with a new-breakdown affordance. */
export function BreakdownsScreen({
  breakdowns,
  totalsByBreakdownId,
  onCreate,
}: BreakdownsScreenProps) {
  const [adding, setAdding] = useState(false)

  return (
    <PageSection
      title="Breakdowns"
      intro="A breakdown is an itemised list whose items roll up into a single budget line."
    >
      {adding ? (
        <NewBreakdownForm
          onSubmit={async (input) => {
            await onCreate(input)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <AddButton label="Add breakdown" onClick={() => setAdding(true)} />
      )}

      {breakdowns.length === 0 && !adding ? (
        <EmptyState>No breakdowns yet.</EmptyState>
      ) : (
        breakdowns.map((breakdown) => (
          <BreakdownItem
            key={breakdown.id}
            breakdown={breakdown}
            annualCents={totalsByBreakdownId.get(breakdown.id) ?? 0}
          />
        ))
      )}
    </PageSection>
  )
}
