import { useState } from 'react'
import {
  Alert,
  FileInput,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Inflow } from '../hooks/useInflows'
import { usePayslipAttachment, type ExtractionState } from '../hooks/usePayslipAttachment'
import { usePayslipFields } from '../hooks/usePayslipFields'
import type {
  PayslipAttachments,
  PayslipInput,
  PayslipRow,
  PayslipSubmission,
} from '../hooks/usePayslips'
import { isoDaysBefore, todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import {
  EXTRACTED_FIELD_LABELS,
  extractedTextKey,
  type ExtractedField,
  type PayslipExtraction,
} from '../lib/payslipExtraction'
import { financialYearForPayPeriod } from '../lib/payslips'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

/** Days a fortnightly pay period spans, less the inclusive end day. */
const FORTNIGHT_SPAN_DAYS = 13

interface PayslipFormProps {
  member: { id: string; name: string }
  /** Every household inflow; only this member's taxable ones are offered as the source. */
  inflows: readonly Inflow[]
  /** Storing, discarding, and reading the document the member attaches. */
  attachments: PayslipAttachments
  initial?: PayslipRow | undefined
  onSubmit: (submission: PayslipSubmission) => void | Promise<void>
  onCancel?: () => void
}

/** A dollars `MoneyInput` in the form's two-column field grid. */
function AmountField({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: number | string
  onChange: (value: number | string) => void
}) {
  return (
    <MoneyInput
      label={label}
      size="sm"
      {...(description !== undefined && { description })}
      min={0}
      hideControls
      value={value}
      onChange={onChange}
    />
  )
}

/** Field names in reading order, e.g. `Gross, Net, and YTD super`. */
function fieldNames(fields: readonly ExtractedField[]): string {
  return fields.map((field) => EXTRACTED_FIELD_LABELS[field]).join(', ')
}

/** Field names with the literal text the model read for each, where it read any. */
function fieldNamesAsRead(
  fields: readonly ExtractedField[],
  extraction: PayslipExtraction,
): string {
  return fields
    .map((field) => {
      const text = extraction.text[extractedTextKey(field)]
      const label = EXTRACTED_FIELD_LABELS[field]
      return text == null ? label : `${label} “${text}”`
    })
    .join(', ')
}

/**
 * What a successful read did, in the model's own words: which figures it filled
 * and the literal text it read for each, which it left because they were already
 * the member's own, which the slip does not show, and which it saw but could not
 * convert. Every figure above stays editable — the point of showing the text is
 * that a misread can be caught here rather than confirmed blind. A field it left
 * alone shows its text too, so a figure the slip disagrees with can be copied
 * across by hand.
 */
function ReadFromSlip({
  extraction,
  filled,
  kept,
}: {
  extraction: PayslipExtraction
  filled: readonly ExtractedField[]
  kept: readonly ExtractedField[]
}) {
  return (
    <Alert color="info" variant="light" p="xs" title="Read from the slip">
      <Stack gap={4}>
        <Text size="xs">Check each figure against the document before saving.</Text>
        {filled.length === 0 ? (
          <Text size="xs" c="dimmed">
            Nothing on the slip could be filled in for you.
          </Text>
        ) : (
          <Text size="xs">Filled in: {fieldNamesAsRead(filled, extraction)}.</Text>
        )}
        {kept.length > 0 && (
          <Text size="xs" c="dimmed">
            Kept what you already had; the slip reads {fieldNamesAsRead(kept, extraction)}.
          </Text>
        )}
        {extraction.missing.length > 0 && (
          <Text size="xs" c="dimmed">
            Not shown on the slip: {fieldNames(extraction.missing)}.
          </Text>
        )}
        {extraction.unreadable.length > 0 && (
          <Text size="xs" c="warning">
            Could not be read safely, so left blank:{' '}
            {fieldNamesAsRead(extraction.unreadable, extraction)}.
          </Text>
        )}
      </Stack>
    </Alert>
  )
}

/**
 * Where attaching a slip has got to, shown under the file picker. Every failure
 * reads as what it is — the feature switched off, a file that is not a payslip,
 * one too large or of a type that cannot be read — and none of them blocks the
 * save: the figures are typed by hand exactly as they always were.
 */
function ExtractionNote({ state }: { state: ExtractionState }) {
  if (state.status === 'idle') {
    return null
  }
  if (state.status === 'uploading' || state.status === 'reading') {
    return (
      <Group gap="xs" role="status">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">
          {state.status === 'uploading' ? 'Storing the slip…' : 'Reading the slip…'}
        </Text>
      </Group>
    )
  }
  if (state.status === 'not-configured') {
    // Off, not broken: an honest note rather than an error the member could act on.
    return (
      <Text size="xs" c="dimmed">
        {state.message}
      </Text>
    )
  }
  if (state.status === 'not-payslip') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">
          {state.message}
          {state.reason !== null && ` ${state.reason}`} Enter the figures by hand.
        </Text>
      </Alert>
    )
  }
  if (state.status === 'failed') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">{state.message}</Text>
      </Alert>
    )
  }
  return <ReadFromSlip extraction={state.extraction} filled={state.filled} kept={state.kept} />
}

/**
 * Presentational add/edit form for one payslip, tagged to the member the section
 * belongs to. The financial year is not typed: it is derived from the pay period
 * and shown back. The source inflow is an explicit choice from the member's own
 * taxable inflows.
 *
 * Attaching a document stores it and reads it: the figures it finds pre-fill the
 * fields that are not already the member's own — typed here, or saved on the
 * payslip being edited — and the text it read is shown back so a misread can be
 * caught. Nothing is confirmed by extraction — every figure is editable and the
 * member's own save is what persists — so an extraction that is unconfigured,
 * refused, or broken only leaves the fields as they were.
 *
 * An inverted pay period (ending before it starts) blocks submission, so the
 * database's own period check is never reached. Persistence lives in the caller.
 */
export function PayslipForm({
  member,
  inflows,
  attachments,
  initial,
  onSubmit,
  onCancel,
}: PayslipFormProps) {
  const fields = usePayslipFields(
    {
      period_start: initial?.period_start ?? isoDaysBefore(todayIso(), FORTNIGHT_SPAN_DAYS),
      period_end: initial?.period_end ?? todayIso(),
      paid_on: initial?.paid_on ?? null,
      gross_cents: centsToDollars(initial?.gross_cents),
      tax_withheld_cents: centsToDollars(initial?.tax_withheld_cents),
      super_cents: centsToDollars(initial?.super_cents),
      net_cents: centsToDollars(initial?.net_cents),
      salary_sacrifice_cents: centsToDollars(initial?.salary_sacrifice_cents),
      ytd_gross_cents: centsToDollars(initial?.ytd_gross_cents),
      ytd_tax_withheld_cents: centsToDollars(initial?.ytd_tax_withheld_cents),
      ytd_super_cents: centsToDollars(initial?.ytd_super_cents),
    },
    // An existing payslip's figures are the member's own, confirmed when they
    // saved them; a new one holds only a defaulted pay period, which is the
    // form's guess and a read may replace.
    initial !== undefined,
  )
  const slip = usePayslipAttachment({
    attachments,
    payslipId: initial?.id ?? null,
    onExtracted: fields.prefill,
  })
  const [sourceInflowId, setSourceInflowId] = useState<string | null>(
    initial?.source_inflow_id ?? null,
  )
  const [note, setNote] = useState(initial?.note ?? '')

  const { values } = fields
  const memberInflows = inflows.filter((inflow) => inflow.taxable && inflow.member_id === member.id)
  const periodInverted =
    values.period_start !== null &&
    values.period_end !== null &&
    values.period_end < values.period_start
  const quartetEntered =
    values.gross_cents !== '' &&
    values.tax_withheld_cents !== '' &&
    values.super_cents !== '' &&
    values.net_cents !== ''
  // A save while the document is still being stored or read would send no
  // attachment, leaving the object filed under an id no row is written under.
  const canSubmit =
    values.period_start !== null &&
    values.period_end !== null &&
    !periodInverted &&
    quartetEntered &&
    !slip.busy
  const financialYear =
    values.period_end === null ? null : financialYearForPayPeriod(values.period_end)

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this payslip. Please try again.',
    onSubmit,
    // The stored document belongs to the saved row from here on, so it is no
    // longer cleaned up as an object nothing references.
    onSuccess: slip.keep,
    buildInput: (): PayslipSubmission => ({
      input: {
        member_id: member.id,
        financial_year: financialYearForPayPeriod(values.period_end!),
        period_start: values.period_start!,
        period_end: values.period_end!,
        paid_on: values.paid_on,
        gross_cents: dollarsToCents(values.gross_cents) ?? 0,
        tax_withheld_cents: dollarsToCents(values.tax_withheld_cents) ?? 0,
        super_cents: dollarsToCents(values.super_cents) ?? 0,
        net_cents: dollarsToCents(values.net_cents) ?? 0,
        salary_sacrifice_cents: dollarsToCents(values.salary_sacrifice_cents),
        ytd_gross_cents: dollarsToCents(values.ytd_gross_cents),
        ytd_tax_withheld_cents: dollarsToCents(values.ytd_tax_withheld_cents),
        ytd_super_cents: dollarsToCents(values.ytd_super_cents),
        source_inflow_id: sourceInflowId,
        note: note.trim() === '' ? null : note.trim(),
      } satisfies PayslipInput,
      attachment: slip.attachment,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="payslip"
      onCancel={onCancel}
    >
      <FileInput
        label="Payslip document"
        size="sm"
        description={
          initial?.file_path == null
            ? 'Stored privately, then read to pre-fill the figures below — which you confirm.'
            : 'Read to pre-fill the figures below, and replaces the document already attached.'
        }
        placeholder="Attach the slip"
        accept="image/*,application/pdf"
        clearable
        clearButtonProps={{ 'aria-label': 'Remove the attached document' }}
        disabled={slip.busy}
        value={slip.file}
        onChange={(file) => void slip.choose(file)}
      />

      <ExtractionNote state={slip.state} />

      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
        <DateInput
          label="Period start"
          size="sm"
          valueFormat="D MMM YYYY"
          clearable
          value={values.period_start}
          onChange={(value) => fields.setDate('period_start', value)}
        />
        <DateInput
          label="Period end"
          size="sm"
          valueFormat="D MMM YYYY"
          clearable
          value={values.period_end}
          onChange={(value) => fields.setDate('period_end', value)}
          {...(periodInverted && { error: 'Must be on or after the period start.' })}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
        <DateInput
          label="Paid on"
          size="sm"
          valueFormat="D MMM YYYY"
          clearable
          placeholder="When the pay landed"
          value={values.paid_on}
          onChange={(value) => fields.setDate('paid_on', value)}
        />
        <Select
          label="Reconciles against"
          size="sm"
          description="The projected inflow this pay period is measured against."
          placeholder={memberInflows.length === 0 ? 'No taxable inflows' : 'No projected inflow'}
          data={memberInflows.map((inflow) => ({ value: inflow.id, label: inflow.name }))}
          value={sourceInflowId}
          onChange={setSourceInflowId}
          clearable
        />
      </SimpleGrid>

      {financialYear !== null && (
        <Text size="xs" c="dimmed">
          Filed under FY{financialYear}, derived from the pay period.
        </Text>
      )}

      <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs">
        <AmountField
          label="Gross"
          value={values.gross_cents}
          onChange={(value) => fields.setAmount('gross_cents', value)}
        />
        <AmountField
          label="Tax withheld"
          value={values.tax_withheld_cents}
          onChange={(value) => fields.setAmount('tax_withheld_cents', value)}
        />
        <AmountField
          label="Super"
          value={values.super_cents}
          onChange={(value) => fields.setAmount('super_cents', value)}
        />
        <AmountField
          label="Net"
          value={values.net_cents}
          onChange={(value) => fields.setAmount('net_cents', value)}
        />
      </SimpleGrid>

      <AmountField
        label="Salary sacrifice"
        description="Concessional sacrifice shown separately on the slip."
        value={values.salary_sacrifice_cents}
        onChange={(value) => fields.setAmount('salary_sacrifice_cents', value)}
      />

      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
        <AmountField
          label="YTD gross"
          value={values.ytd_gross_cents}
          onChange={(value) => fields.setAmount('ytd_gross_cents', value)}
        />
        <AmountField
          label="YTD tax withheld"
          value={values.ytd_tax_withheld_cents}
          onChange={(value) => fields.setAmount('ytd_tax_withheld_cents', value)}
        />
        <AmountField
          label="YTD super"
          value={values.ytd_super_cents}
          onChange={(value) => fields.setAmount('ytd_super_cents', value)}
        />
      </SimpleGrid>

      <TextInput
        label="Note"
        size="sm"
        placeholder="e.g. Includes back-pay"
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </FormShell>
  )
}
