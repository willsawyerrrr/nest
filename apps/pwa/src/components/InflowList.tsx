import { useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import { ActionIcon, Badge, Box, Button, Card, Group, Stack, Text } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { fortnightlyCents } from '@budget/plan'
import { annualGrossCents } from '@budget/tax'
import type { Member } from '../hooks/useMembers'
import type { Inflow, InflowInput } from '../hooks/useInflows'
import { formatCents } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { toIncomeInput } from '../lib/tax'
import { InflowForm } from './InflowForm'

interface InflowListProps {
  inflows: Inflow[]
  members: Member[]
  onCreate: (input: InflowInput) => Promise<void>
  onUpdate: (id: string, input: InflowInput) => Promise<void>
  onDelete: (id: string) => void
}

/** Describes an inflow's entered amount: a flat amount, or a wage's rate × hours. */
function describeAmount(inflow: Inflow): string {
  if (inflow.type === 'wage') {
    const rate = formatCents(inflow.hourly_rate_cents ?? 0)
    return `${rate} × ${inflow.hours_per_period ?? 0} hrs`
  }
  return formatCents(inflow.amount_cents ?? 0)
}

/** The inflow's fortnightly-normalised gross, via its annualised gross. */
function fortnightlyOf(inflow: Inflow): number {
  return fortnightlyCents(annualGrossCents(toIncomeInput(inflow)), 'annual')
}

/** The member tag for a taxable inflow, or a non-taxable indicator otherwise. */
function memberOrTaxability(inflow: Inflow, memberName: (id: string) => string): string {
  if (!inflow.taxable) {
    return 'Non-taxable'
  }
  return inflow.member_id ? memberName(inflow.member_id) : 'Taxable'
}

/** The edit and delete controls shared by both the row and the card treatments. */
function InflowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <>
      <ActionIcon variant="subtle" aria-label="Edit" onClick={onEdit}>
        <IconPencil size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="red" aria-label="Delete" onClick={onDelete}>
        <IconTrash size={16} />
      </ActionIcon>
    </>
  )
}

/**
 * One inflow as a single dense table-like row for desktop: the name grows to
 * fill with its type badge, then the member/taxability, entered amount,
 * frequency, and fortnightly figure right-aligned in fixed columns, with the
 * controls at the end and a light rule rather than a bordered card so many
 * inflows fit and scan as a table.
 */
function InflowRow({
  inflow,
  memberName,
  onEdit,
  onDelete,
}: {
  inflow: Inflow
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Group
      wrap="nowrap"
      gap="md"
      py={6}
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {inflow.name}
        </Text>
        <Badge size="xs" variant="light" color={inflow.taxable ? 'teal' : 'gray'} tt="capitalize">
          {inflow.type}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" ta="right" truncate style={{ width: '6rem', flexShrink: 0 }}>
        {memberOrTaxability(inflow, memberName)}
      </Text>
      <Text size="sm" c="dimmed" ta="right" style={{ width: '8rem', flexShrink: 0 }}>
        {describeAmount(inflow)}
      </Text>
      <Box style={{ width: '8rem', flexShrink: 0, textAlign: 'right' }}>
        <Badge size="sm" variant="light">
          {formatFrequency(inflow.schedule, inflow.interval_weeks)}
        </Badge>
      </Box>
      <Group
        gap={2}
        wrap="nowrap"
        justify="flex-end"
        align="baseline"
        style={{ width: '7rem', flexShrink: 0 }}
      >
        <Text fw={700} size="sm">
          {formatCents(fortnightlyOf(inflow))}
        </Text>
        <Text size="xs" c="dimmed">
          / fn
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <InflowActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </Group>
  )
}

/** One inflow as a compact bordered card for mobile: name stacked over its facts. */
function InflowCard({
  inflow,
  memberName,
  onEdit,
  onDelete,
}: {
  inflow: Inflow
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {inflow.name}
          </Text>
          <Group gap={6} wrap="wrap">
            {inflow.member_id && (
              <Text size="xs" c="dimmed">
                {memberName(inflow.member_id)}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {describeAmount(inflow)}
            </Text>
            <Badge size="xs" variant="light" color={inflow.taxable ? 'teal' : 'gray'}>
              {inflow.taxable ? 'Taxable' : 'Non-taxable'}
            </Badge>
            <Badge size="xs" variant="light" tt="capitalize">
              {inflow.type}
            </Badge>
            <Badge size="xs" variant="outline">
              {formatFrequency(inflow.schedule, inflow.interval_weeks)}
            </Badge>
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Group gap={2} wrap="nowrap" align="baseline">
            <Text fw={700} size="sm">
              {formatCents(fortnightlyOf(inflow))}
            </Text>
            <Text size="xs" c="dimmed">
              / fn
            </Text>
          </Group>
          <InflowActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </Card>
  )
}

/**
 * A single inflow, rendered as a dense table-like row from the `sm` breakpoint up
 * and as a compact bordered card below it.
 */
function InflowItem(props: {
  inflow: Inflow
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <InflowRow {...props} /> : <InflowCard {...props} />
}

/** The household's inflows with an add affordance and inline add/edit forms. */
export function InflowList({ inflows, members, onCreate, onUpdate, onDelete }: InflowListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'

  const startAdding = () => {
    setEditingId(null)
    setAdding(true)
  }
  const startEditing = (id: string) => {
    setAdding(false)
    setEditingId(id)
  }
  const closeForms = () => {
    setEditingId(null)
    setAdding(false)
  }

  return (
    <Stack gap="sm">
      {inflows.length === 0 && !adding ? (
        <Text c="dimmed" ta="center">
          No inflows yet. Add one to get started.
        </Text>
      ) : (
        inflows.map((inflow) =>
          editingId === inflow.id ? (
            <InflowForm
              key={inflow.id}
              members={members}
              initial={inflow}
              onSubmit={async (input) => {
                await onUpdate(inflow.id, input)
                closeForms()
              }}
              onCancel={closeForms}
            />
          ) : (
            <InflowItem
              key={inflow.id}
              inflow={inflow}
              memberName={memberName}
              onEdit={() => startEditing(inflow.id)}
              onDelete={() => onDelete(inflow.id)}
            />
          ),
        )
      )}

      {adding ? (
        <InflowForm
          members={members}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <Button variant="light" fullWidth onClick={startAdding}>
          Add inflow
        </Button>
      )}
    </Stack>
  )
}
