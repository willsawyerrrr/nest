/* eslint-disable react/only-export-components -- the screen and its row-shape types are one unit. */
import { Alert, Badge, Button, Group, Stack, Table, Text } from '@mantine/core'
import type { PlanningTable } from '../lib/planningMode'
import { AppCard } from './AppCard'
import { ComparedAmount, ComparedDate } from './ComparedAmount'
import { DataTable } from './DataTable'
import { EmptyState } from './EmptyState'
import { PageSection } from './PageSection'

/** One field a sandbox update moved, with its real and proposed values already formatted. */
export interface PlanningOverrideChange {
  field: string
  was: string
  now: string
}

/** One row the sandbox is holding an edit for: an update, a create, or a delete. */
export interface PlanningOverride {
  table: PlanningTable
  /** Human table name, e.g. `Inflow`. */
  tableLabel: string
  id: string
  rowName: string
  kind: 'update' | 'create' | 'delete'
  /** The moved fields, for an update; empty for a create or delete. */
  changes: PlanningOverrideChange[]
}

/** One rolled-up money figure, real vs proposed. */
export interface PlanningRollupFigure {
  label: string
  baselineCents: number
  proposedCents: number
  /** Tint the figure itself by sign (a balance that can be a refund or a bill). */
  colored?: boolean
}

/** One goal's ETA, real vs proposed. */
export interface PlanningGoalEta {
  name: string
  baselineIso: string | null
  proposedIso: string | null
}

interface PlanningScreenProps {
  overrides: PlanningOverride[]
  figures: PlanningRollupFigure[]
  goalEtas: PlanningGoalEta[]
  onResetRow: (table: PlanningTable, id: string) => void
  onDiscard: () => void
  onExit: () => void
  onSave: () => void
  /** True while a save is in flight — disables every footer action until it settles. */
  saving: boolean
  /** The message from a failed save, or `null` between attempts. The held changes survive a failure. */
  saveError: string | null
}

const KIND_LABEL: Record<PlanningOverride['kind'], { label: string; color: string }> = {
  update: { label: 'Edited', color: 'info' },
  create: { label: 'New', color: 'positive' },
  delete: { label: 'Removed', color: 'negative' },
}

/** One held row: its name, what kind of edit, the moved fields, and a Reset. */
function OverrideRow({ override, onReset }: { override: PlanningOverride; onReset: () => void }) {
  const kind = KIND_LABEL[override.kind]
  return (
    <Stack
      gap={4}
      py="xs"
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge size="xs" variant="light" color={kind.color}>
            {kind.label}
          </Badge>
          <Text size="sm" fw={600} truncate>
            {override.rowName}
          </Text>
          <Text size="xs" c="dimmed">
            {override.tableLabel}
          </Text>
        </Group>
        <Button size="compact-xs" variant="subtle" onClick={onReset} style={{ flexShrink: 0 }}>
          Reset
        </Button>
      </Group>
      {override.changes.map((change) => (
        <Text key={change.field} size="xs" c="dimmed">
          {`${fieldLabel(change.field)}: ${change.was} → ${change.now}`}
        </Text>
      ))}
    </Stack>
  )
}

/**
 * Humanises a column name for display: `amount_cents` → `amount`,
 * `target_date` → `target date`, `destination_account_id` → `destination account`.
 */
export function fieldLabel(field: string): string {
  return field
    .replace(/_cents$/, '')
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
}

/**
 * The Planning tab: every change the sandbox is holding, each with a Reset, then
 * a roll-up of what those changes do to the fortnightly buffer, the year's tax
 * and take-home, each goal's ETA, and net worth — real vs proposed vs delta.
 * Save writes every held change for real and clears the sandbox; Discard drops
 * every change instead; Exit leaves planning mode.
 */
export function PlanningScreen({
  overrides,
  figures,
  goalEtas,
  onResetRow,
  onDiscard,
  onExit,
  onSave,
  saving,
  saveError,
}: PlanningScreenProps) {
  return (
    <PageSection
      title="Planning"
      intro="Every change planning mode is holding, and what it does to your plan. Save to make it real, or discard it."
    >
      <AppCard>
        <Stack gap="xs">
          <Text fw={600}>Pending changes</Text>
          {overrides.length === 0 ? (
            <EmptyState>
              No changes yet. Edit a pay, a bill, or a savings goal and it shows up here.
            </EmptyState>
          ) : (
            overrides.map((override) => (
              <OverrideRow
                key={`${override.table}:${override.id}`}
                override={override}
                onReset={() => onResetRow(override.table, override.id)}
              />
            ))
          )}
        </Stack>
      </AppCard>

      <AppCard>
        <Stack gap="xs">
          <Text fw={600}>Projected impact</Text>
          <DataTable label="Projected impact">
            <Table.Tbody>
              {figures.map((figure) => (
                <Table.Tr key={figure.label}>
                  <Table.Th scope="row" fw={500}>
                    {figure.label}
                  </Table.Th>
                  <Table.Td ta="right">
                    <ComparedAmount
                      span
                      baselineCents={figure.baselineCents}
                      proposedCents={figure.proposedCents}
                      colored={figure.colored ?? false}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
              {goalEtas.map((goal) => (
                <Table.Tr key={`goal:${goal.name}`}>
                  <Table.Th scope="row" fw={500}>
                    {goal.name} ETA
                  </Table.Th>
                  <Table.Td ta="right">
                    <ComparedDate
                      span
                      baselineIso={goal.baselineIso}
                      proposedIso={goal.proposedIso}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </Stack>
      </AppCard>

      {saveError && (
        <Alert color="red" variant="light">
          {saveError}
        </Alert>
      )}

      <Group justify="flex-end" gap="sm">
        <Button
          variant="light"
          color="red"
          onClick={onDiscard}
          disabled={overrides.length === 0 || saving}
        >
          Discard changes
        </Button>
        <Button variant="filled" color="warning" onClick={onExit} disabled={saving}>
          Exit planning mode
        </Button>
        <Button
          variant="filled"
          color="positive"
          onClick={onSave}
          disabled={overrides.length === 0}
          loading={saving}
        >
          Save changes
        </Button>
      </Group>
    </PageSection>
  )
}
