import { NumberInput, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { OneOffPaymentSplit } from '@nest/tax'
import type { Member } from '../hooks/useMembers'
import { ONE_OFF_TAX_TREATMENT_OPTIONS } from '../lib/inflowTypes'
import { formatCents, formatRatePercent } from '../lib/money'
import { previewOneOffSplit, type OneOffDraft } from '../lib/oneOffInflow'
import { currentTaxConfig } from '../lib/tax'
import { EnumSelect } from './EnumSelect'

interface InflowOneOffFieldsProps {
  /** Whether the payment is taxable, which is what gives it a treatment at all. */
  taxable: boolean
  /** The amount entered above, for showing the split it produces. */
  amountCents: number | null
  /** The member the payment is tagged to, whose age at the payment date sets the rate. */
  member: Member | undefined
  draft: OneOffDraft
  onChange: (draft: OneOffDraft) => void
}

/**
 * How the payment splits under the treatment chosen, shown before it is saved: what
 * is excluded from assessable income entirely, what joins it, and the capped rate the
 * concessional part bears. Together they are the whole of the concession, so seeing
 * them here is what makes a redundancy's tax-free amount a decision rather than a
 * surprise in the estimate.
 *
 * A nil concessional part carries no rate, there being nothing for one to apply to —
 * ordinary income is the whole of that case, and so is a redundancy small enough to
 * be tax-free outright. The concessional amount shown is the most that can be one:
 * the cap on a payment that is not a redundancy falls as the member's other income
 * rises, and the estimate is where that lands.
 */
function SplitPreview({ split, capped }: { split: OneOffPaymentSplit; capped: boolean }) {
  return (
    <Stack gap={0}>
      {split.taxFreeCents > 0 && (
        <Text size="xs" c="dimmed">
          {formatCents(split.taxFreeCents)} is tax free — excluded from assessable income entirely.
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {formatCents(split.assessableCents)} is assessable income.
      </Text>
      {split.concessionalCents > 0 && (
        <Text size="xs" c="dimmed">
          {formatCents(split.concessionalCents)} of that is taxed at{' '}
          {formatRatePercent(split.concessionalRate)}, plus the 2% Medicare levy.
          {capped &&
            ' Your other income for the year lowers that amount, which the Tax tab applies.'}
        </Text>
      )}
    </Stack>
  )
}

/**
 * The fields a ONE-OFF inflow carries in place of a cadence: the single date its
 * money lands on, and — for a taxable payment — the concession it is assessed under
 * and the completed years of service a genuine redundancy's tax-free amount is priced
 * from. A non-taxable one-off (a gift) is taxed under nothing and so shows only its
 * date.
 *
 * They live here rather than in the form so the form stays the shape of an inflow
 * rather than the shape of two inflows sharing a file.
 */
export function InflowOneOffFields({
  taxable,
  amountCents,
  member,
  draft,
  onChange,
}: InflowOneOffFieldsProps) {
  const split = previewOneOffSplit(
    draft,
    taxable,
    amountCents,
    member?.date_of_birth ?? null,
    currentTaxConfig(),
  )

  return (
    <>
      <DateInput
        label="Paid on"
        size="sm"
        description="The single date this money lands on. It counts in full in the financial year that date falls in, and never in any other."
        valueFormat="D MMM YYYY"
        clearable
        value={draft.paidOn}
        onChange={(paidOn) => onChange({ ...draft, paidOn })}
      />

      {taxable && (
        <EnumSelect
          label="Tax treatment"
          size="sm"
          description="What the payment is for, which is what decides the concession it is taxed under rather than its size."
          data={ONE_OFF_TAX_TREATMENT_OPTIONS}
          value={draft.treatment}
          onChange={(treatment) => treatment && onChange({ ...draft, treatment })}
          allowDeselect={false}
        />
      )}

      {taxable && draft.treatment === 'genuine_redundancy' && (
        <NumberInput
          label="Completed years of service"
          size="sm"
          description="Whole years worked for the employer. The tax-free amount is a base limit plus a set amount for each of them."
          min={0}
          step={1}
          allowDecimal={false}
          allowNegative={false}
          hideControls
          value={draft.yearsOfService}
          onChange={(yearsOfService) => onChange({ ...draft, yearsOfService })}
        />
      )}

      {split !== null && (
        <SplitPreview split={split} capped={draft.treatment === 'employment_termination'} />
      )}
    </>
  )
}
