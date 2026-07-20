import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { fortnightlyCents } from '@nest/plan'
import type { Medication, MedicationInput } from '../hooks/useMedications'
import { medicationsAnnualTotalCents } from '../lib/medications'
import { formatCents } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { MedicationForm } from './MedicationForm'

interface MedicationsScreenProps {
  medications: Medication[]
  onCreate: (input: MedicationInput) => Promise<void>
  onUpdate: (id: string, input: MedicationInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

/** One medication row: name, optional dose, cost + frequency, and its fortnightly figure. */
function MedicationRow({
  medication,
  onEdit,
  onDelete,
}: {
  medication: Medication
  onEdit: () => void
  onDelete: () => void
}) {
  const fortnightly = fortnightlyCents(
    medication.amount_cents,
    medication.frequency,
    medication.interval_weeks ?? undefined,
  )
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {medication.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {formatCents(medication.amount_cents)}
            </Text>
            <Badge size="xs" variant="light">
              {formatFrequency(medication.frequency, medication.interval_weeks)}
            </Badge>
            {medication.dose && (
              <Text size="xs" c="dimmed" truncate>
                {medication.dose}
              </Text>
            )}
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Group gap={2} wrap="nowrap" align="baseline">
            <Text fw={700} size="sm">
              {formatCents(fortnightly)}
            </Text>
            <Text size="xs" c="dimmed">
              / fn
            </Text>
          </Group>
          <ActionIcon variant="subtle" aria-label={`Edit ${medication.name}`} onClick={onEdit}>
            <IconPencil size={16} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Delete ${medication.name}`}
            onClick={onDelete}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </Card>
  )
}

/** Presentational medication tracker: a flat list of medications with a fortnightly cost rollup. */
export function MedicationsScreen({
  medications,
  onCreate,
  onUpdate,
  onDelete,
}: MedicationsScreenProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const annualTotal = medicationsAnnualTotalCents(medications)
  const fortnightlyTotal = fortnightlyCents(annualTotal, 'annual')

  return (
    <Stack gap="md">
      <Title order={2}>Health</Title>

      <Text c="dimmed" size="sm">
        Medications with a recurring cost. Their total rolls up into a single Needs budget line.
      </Text>

      {medications.length > 0 && (
        <Card withBorder radius="md" p="sm">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Title order={4}>Total</Title>
            <Group gap="md" wrap="nowrap" align="baseline">
              <Group gap={2} wrap="nowrap" align="baseline">
                <Text fw={700}>{formatCents(fortnightlyTotal)}</Text>
                <Text size="xs" c="dimmed">
                  / fn
                </Text>
              </Group>
              <Group gap={2} wrap="nowrap" align="baseline">
                <Text fw={700}>{formatCents(annualTotal)}</Text>
                <Text size="xs" c="dimmed">
                  / year
                </Text>
              </Group>
            </Group>
          </Group>
        </Card>
      )}

      {medications.length === 0 && !adding && (
        <Text c="dimmed" size="sm">
          No medications yet.
        </Text>
      )}

      {medications.map((medication) =>
        editingId === medication.id ? (
          <MedicationForm
            key={medication.id}
            initial={medication}
            onSubmit={async (input) => {
              await onUpdate(medication.id, input)
              setEditingId(null)
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <MedicationRow
            key={medication.id}
            medication={medication}
            onEdit={() => {
              setAdding(false)
              setEditingId(medication.id)
            }}
            onDelete={() => void onDelete(medication.id)}
          />
        ),
      )}

      {adding ? (
        <MedicationForm
          onSubmit={async (input) => {
            await onCreate(input)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          variant="light"
          fullWidth
          onClick={() => {
            setEditingId(null)
            setAdding(true)
          }}
        >
          Add medication
        </Button>
      )}
    </Stack>
  )
}
