import { useState } from 'react'
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Inflow, InflowInput } from '../hooks/useInflows'
import { formatCents } from '../lib/money'
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

/** One inflow's display card, with edit/delete controls. */
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
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600}>{inflow.name}</Text>
            {inflow.member_id && (
              <Text size="sm" c="dimmed">
                {memberName(inflow.member_id)}
              </Text>
            )}
            <Text size="lg" fw={700}>
              {describeAmount(inflow)}
            </Text>
          </Stack>
          <Group gap={4} wrap="wrap" justify="flex-end">
            <Badge variant="light" color={inflow.taxable ? 'teal' : 'gray'}>
              {inflow.taxable ? 'Taxable' : 'Non-taxable'}
            </Badge>
            <Badge variant="light" tt="capitalize">
              {inflow.type}
            </Badge>
            <Badge variant="outline" tt="capitalize">
              {inflow.schedule}
            </Badge>
          </Group>
        </Group>
        <Group grow>
          <Button variant="light" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="subtle" color="red" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Card>
  )
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
        <Button fullWidth onClick={startAdding}>
          Add inflow
        </Button>
      )}

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
            <InflowCard
              key={inflow.id}
              inflow={inflow}
              memberName={memberName}
              onEdit={() => startEditing(inflow.id)}
              onDelete={() => onDelete(inflow.id)}
            />
          ),
        )
      )}
    </Stack>
  )
}
