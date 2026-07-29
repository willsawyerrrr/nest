import type { ReactNode } from 'react'
import { ActionIcon, Alert, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import type { PayslipLineKind, PayslipTaxComponent } from '../hooks/usePayslipLines'
import { formatCents } from '../lib/money'
import { MoneyInput } from './MoneyInput'

/**
 * One line being edited: its amount held as a dollars input value. The two
 * references are exclusive, as the stored line's own check constraint requires —
 * an earnings line carries the inflow it draws on and a tax line the component it
 * pays — and the unused one is dropped on save.
 */
export interface LineDraft {
  /** Stable across removals, so a row keeps its inputs as its siblings go. */
  readonly id: number
  readonly kind: PayslipLineKind
  readonly label: string
  readonly amount: number | string
  readonly sourceInflowId: string | null
  readonly component: PayslipTaxComponent | null
}

/** An option per inflow an earnings line may draw on. */
export interface InflowOption {
  readonly value: string
  readonly label: string
}

/** The parts of the liability a tax line may pay, as the slip names them. */
const TAX_COMPONENT_OPTIONS: readonly { value: PayslipTaxComponent; label: string }[] = [
  { value: 'payg', label: 'PAYG income tax' },
  { value: 'stsl', label: 'STSL (study loan)' },
]

/**
 * A line's name and amount, with whatever it is measured against beside them.
 * Every control is labelled by its line's kind and position, so the rows stay
 * distinguishable without repeating a visible label per row.
 */
function LineFields({
  line,
  position,
  kindLabel,
  onChange,
  onRemove,
  children,
}: {
  line: LineDraft
  position: number
  /** Names the row's kind in each control's label, e.g. `Earnings line 2 name`. */
  kindLabel: string
  onChange: (changes: Partial<LineDraft>) => void
  onRemove: () => void
  /** The select naming what the line is measured against. */
  children: ReactNode
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          size="xs"
          aria-label={`${kindLabel} ${position} name`}
          placeholder={line.kind === 'tax' ? 'e.g. PAYG' : 'e.g. Ordinary Hours'}
          value={line.label}
          onChange={(event) => onChange({ label: event.currentTarget.value })}
        />
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <MoneyInput
            size="xs"
            aria-label={`${kindLabel} ${position} amount`}
            placeholder="Amount"
            hideControls
            style={{ flex: 1, minWidth: 0 }}
            value={line.amount}
            onChange={(value) => onChange({ amount: value })}
          />
          {children}
        </Group>
      </Stack>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Remove ${kindLabel.toLowerCase()} ${position}`}
        onClick={onRemove}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  )
}

/**
 * How much of a printed total the lines account for. They need not sum to it — an
 * amount nobody has itemised is unallocated — so the gap is stated rather than
 * corrected.
 */
function AllocationNote({
  unallocatedCents,
  overMessage,
  underMessage,
}: {
  unallocatedCents: number
  /** How a remainder reads, e.g. that unitemised gross reads as gross above plan. */
  overMessage: string
  /** How lines overshooting the printed total read. */
  underMessage: string
}) {
  if (unallocatedCents === 0) {
    return (
      <Text size="xs" c="dimmed">
        Every dollar is itemised.
      </Text>
    )
  }
  return (
    <Text size="xs" c="dimmed">
      {formatCents(Math.abs(unallocatedCents))} {unallocatedCents > 0 ? overMessage : underMessage}
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
        the earnings that are missing, or remove the lines to leave the gross unmeasured.
      </Text>
    </Alert>
  )
}

/**
 * A payslip's earnings lines. Itemising is what measures the slip at all: each
 * inflow's lines are summed and measured against that inflow on its own — which is
 * what keeps a lumpy allowance out of a steady salary's variance, and an allowance
 * that earns no super out of the expected super — and the largest group's inflow is
 * the pay cycle the slip's own withholding and super expectations are divided by.
 * Presentational: the drafts and their edits live in the form.
 */
export function PayslipEarningsLinesField({
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
  /** Every earnings line on the slip summed, as the form has them typed. */
  allocatedCents: number
  /** The slip's gross less every earnings line on it, as the form has them typed. */
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
          and an allowance that earns no super is left out of the expected super. The largest
          group’s inflow is the pay cycle the slip’s tax and super expectations are read from.
        </Text>
      </Stack>

      {lines.map((line, index) => (
        <LineFields
          key={line.id}
          line={line}
          position={index + 1}
          kindLabel="Earnings line"
          onChange={(changes) => onChange(line.id, changes)}
          onRemove={() => onRemove(line.id)}
        >
          <Select
            size="xs"
            aria-label={`Earnings line ${index + 1} draws on`}
            placeholder={options.length === 0 ? 'No taxable inflows' : 'Draws on'}
            data={options as InflowOption[]}
            style={{ flex: 1, minWidth: 0 }}
            clearable
            value={line.sourceInflowId}
            onChange={(value) => onChange(line.id, { sourceInflowId: value })}
          />
        </LineFields>
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
        {lines.length > 0 && (
          <AllocationNote
            unallocatedCents={unallocatedCents}
            overMessage="of the gross is not itemised, and reads as gross above plan."
            underMessage="more than the gross is itemised, so a line or the gross is wrong."
          />
        )}
      </Group>

      <PartialItemisationNote
        unallocatedCents={unallocatedCents}
        allocatedCents={allocatedCents}
        hasMappedLine={lines.some((line) => line.sourceInflowId !== null)}
      />
    </Stack>
  )
}

/**
 * A payslip's tax lines. A slip's TAX section prints PAYG income tax and any STSL
 * study-loan component beneath one total, and the two pay different parts of the
 * same liability, so each is measured against its own — STSL against the compulsory
 * HELP repayment and PAYG against the income tax and levies that are the rest.
 * Itemising splits how the variance reads, never what the year counts as withheld:
 * that stays the printed total above. Presentational, as the earnings field is.
 */
export function PayslipTaxLinesField({
  lines,
  unallocatedCents,
  onChange,
  onAdd,
  onRemove,
}: {
  lines: readonly LineDraft[]
  /** The slip's printed tax total less every tax line on it, as the form has them typed. */
  unallocatedCents: number
  onChange: (id: number, changes: Partial<LineDraft>) => void
  onAdd: () => void
  onRemove: (id: number) => void
}) {
  return (
    <Stack gap="xs">
      <Stack gap={0}>
        <Text size="sm" fw={500}>
          Tax lines
        </Text>
        <Text size="xs" c="dimmed">
          Itemise the slip’s TAX section so each withholding is measured against the part of the
          liability it pays: STSL against the compulsory HELP repayment, PAYG against the income tax
          and levies. The tax withheld above stays the printed total, which is what the year’s
          refund or bill is worked out from.
        </Text>
      </Stack>

      {lines.map((line, index) => (
        <LineFields
          key={line.id}
          line={line}
          position={index + 1}
          kindLabel="Tax line"
          onChange={(changes) => onChange(line.id, changes)}
          onRemove={() => onRemove(line.id)}
        >
          <Select
            size="xs"
            aria-label={`Tax line ${index + 1} pays`}
            placeholder="Pays down"
            data={TAX_COMPONENT_OPTIONS as { value: string; label: string }[]}
            style={{ flex: 1, minWidth: 0 }}
            value={line.component}
            onChange={(value) =>
              onChange(line.id, { component: value as PayslipTaxComponent | null })
            }
          />
        </LineFields>
      ))}

      <Group justify="space-between" gap="xs">
        <Button
          type="button"
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={onAdd}
        >
          Add tax line
        </Button>
        {lines.length > 0 && (
          <AllocationNote
            unallocatedCents={unallocatedCents}
            overMessage="of the tax withheld is not itemised."
            underMessage="more than the tax withheld is itemised, so a line or the total is wrong."
          />
        )}
      </Group>
    </Stack>
  )
}
