import { ActionIcon, Alert, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { formatCents } from '../lib/money'
import { MoneyInput } from './MoneyInput'

/** One earnings line being edited: its amount held as a dollars input value. */
export interface LineDraft {
  /** Stable across removals, so a row keeps its inputs as its siblings go. */
  readonly id: number
  readonly label: string
  readonly amount: number | string
  readonly sourceInflowId: string | null
}

/** An option per inflow a line may draw on. */
export interface InflowOption {
  readonly value: string
  readonly label: string
}

/**
 * One earnings line: its name as the slip prints it, its amount, and the
 * projected inflow it draws on. Every control is labelled by its line's position,
 * so the rows stay distinguishable without repeating a visible label per row.
 */
function LineFields({
  line,
  position,
  options,
  onChange,
  onRemove,
}: {
  line: LineDraft
  position: number
  options: readonly InflowOption[]
  onChange: (changes: Partial<LineDraft>) => void
  onRemove: () => void
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          size="xs"
          aria-label={`Line ${position} name`}
          placeholder="e.g. Ordinary Hours"
          value={line.label}
          onChange={(event) => onChange({ label: event.currentTarget.value })}
        />
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <MoneyInput
            size="xs"
            aria-label={`Line ${position} amount`}
            placeholder="Amount"
            hideControls
            style={{ flex: 1, minWidth: 0 }}
            value={line.amount}
            onChange={(value) => onChange({ amount: value })}
          />
          <Select
            size="xs"
            aria-label={`Line ${position} draws on`}
            placeholder={options.length === 0 ? 'No taxable inflows' : 'Draws on'}
            data={options as InflowOption[]}
            style={{ flex: 1, minWidth: 0 }}
            clearable
            value={line.sourceInflowId}
            onChange={(value) => onChange({ sourceInflowId: value })}
          />
        </Group>
      </Stack>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Remove line ${position}`}
        onClick={onRemove}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  )
}

/**
 * How much of the slip's gross the lines account for. They need not sum to it —
 * an earning nobody has itemised is unallocated, and reads as gross above plan —
 * so the gap is stated rather than corrected.
 */
function AllocationNote({ unallocatedCents }: { unallocatedCents: number }) {
  if (unallocatedCents === 0) {
    return (
      <Text size="xs" c="dimmed">
        Every dollar of the gross is itemised.
      </Text>
    )
  }
  return (
    <Text size="xs" c="dimmed">
      {formatCents(Math.abs(unallocatedCents))}{' '}
      {unallocatedCents > 0
        ? 'of the gross is not itemised, and reads as gross above plan.'
        : 'more than the gross is itemised, so a line or the gross is wrong.'}
    </Text>
  )
}

/**
 * Half-itemising is the trap this warns about: itemise the on-call allowance,
 * leave the salary paid beside it untyped, and the expected gross collapses to
 * the allowance's projection while the actual gross is the whole payment — a
 * phantom variance the size of the salary. The signal is a remainder larger than
 * everything itemised, with at least one line naming a projection to be measured
 * against: that is a missing line, not a rounding gap.
 */
function PartialItemisationNote({
  unallocatedCents,
  allocatedCents,
  hasMappedLine,
}: {
  unallocatedCents: number
  allocatedCents: number
  hasMappedLine: boolean
}) {
  if (!hasMappedLine || unallocatedCents <= allocatedCents) {
    return null
  }
  return (
    <Alert color="warning" variant="light" p="xs">
      <Text size="xs">
        More of the gross is unitemised ({formatCents(unallocatedCents)}) than itemised. Expected
        gross counts only the lines above, so the rest reads as a gross variance that large. Itemise
        the earnings that are missing, or remove the lines to measure the whole gross against one
        inflow.
      </Text>
    </Alert>
  )
}

/**
 * A payslip's earnings lines. Itemising is optional: with no lines the whole
 * gross is measured against the single inflow the slip reconciles against, and
 * with them each inflow's lines are summed and measured against that inflow on
 * its own — which is what keeps a lumpy allowance out of a steady salary's
 * variance, and an allowance that earns no super out of the expected super.
 * Presentational: the drafts and their edits live in the form.
 */
export function PayslipLinesField({
  lines,
  options,
  allocatedCents,
  unallocatedCents,
  onChange,
  onAdd,
  onRemove,
}: {
  lines: readonly LineDraft[]
  options: readonly InflowOption[]
  /** Every line on the slip summed, as the form has them typed. */
  allocatedCents: number
  /** The slip's gross less every line on it, as the form has them typed. */
  unallocatedCents: number
  onChange: (id: number, changes: Partial<LineDraft>) => void
  onAdd: () => void
  onRemove: (id: number) => void
}) {
  return (
    <Stack gap="xs">
      <Stack gap={0}>
        <Text size="sm" fw={500}>
          Earnings lines
        </Text>
        <Text size="xs" c="dimmed">
          Itemise the slip so each earning is measured against the inflow it draws on. Several lines
          may draw on the same inflow — ordinary hours and annual leave both draw on the salary —
          and an allowance that earns no super is left out of the expected super. Leave this empty
          to measure the whole gross against one inflow.
        </Text>
      </Stack>

      {lines.map((line, index) => (
        <LineFields
          key={line.id}
          line={line}
          position={index + 1}
          options={options}
          onChange={(changes) => onChange(line.id, changes)}
          onRemove={() => onRemove(line.id)}
        />
      ))}

      <Group justify="space-between" gap="xs">
        <Button
          type="button"
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={onAdd}
        >
          Add earnings line
        </Button>
        {lines.length > 0 && <AllocationNote unallocatedCents={unallocatedCents} />}
      </Group>

      <PartialItemisationNote
        unallocatedCents={unallocatedCents}
        allocatedCents={allocatedCents}
        hasMappedLine={lines.some((line) => line.sourceInflowId !== null)}
      />
    </Stack>
  )
}
