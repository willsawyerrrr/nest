import { useState } from 'react'
import { Alert, FileInput, Group, Loader, SimpleGrid, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Inflow } from '../hooks/useInflows'
import { usePayslipAttachment, type ExtractionState } from '../hooks/usePayslipAttachment'
import { usePayslipFields } from '../hooks/usePayslipFields'
import { lineEntered, usePayslipLineDrafts, type LineDraft } from '../hooks/usePayslipLineDrafts'
import type { PayslipLineInput, PayslipLineRow } from '../hooks/usePayslipLines'
import type {
  PayslipAttachments,
  PayslipInput,
  PayslipRow,
  PayslipSubmission,
} from '../hooks/usePayslips'
import { isoDaysBefore, todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { financialYearForPayslip } from '../lib/payslips'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'
import { PayslipEarningsLinesField, PayslipTaxLinesField } from './PayslipLinesField'

/** Days a fortnightly pay period spans, less the inclusive end day. */
const FORTNIGHT_SPAN_DAYS = 13

interface PayslipFormProps {
  member: { id: string; name: string }
  /** Every household inflow; only this member's taxable ones are offered to a line. */
  inflows: readonly Inflow[]
  /** The lines already on the payslip being edited; empty when adding. */
  initialLines?: readonly PayslipLineRow[]
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

/**
 * What a successful read amounts to, in one line. Every figure it filled is already
 * on screen in the field it filled, so the note attributes the lot to the model and
 * asks for a check against the document rather than restating values the member is
 * looking at. Anything needing an answer is raised at the control it concerns — a
 * tax line the slip does not place asks on its own "Pays down" picker — because a
 * paragraph cannot say which row is meant.
 */
function ReadFromSlip({ state }: { state: Extract<ExtractionState, { status: 'read' }> }) {
  const filledNothing = state.filled.length === 0 && state.filledLines.length === 0
  return (
    <Alert color="info" variant="light" p="xs" title="Read from the slip">
      <Text size="xs">
        {filledNothing
          ? 'Nothing on the slip could be filled in for you.'
          : 'The details below were extracted from the document by AI — check them against it before saving.'}
      </Text>
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
  if (
    state.status === 'not-configured' ||
    state.status === 'out-of-credit' ||
    state.status === 'key-rejected'
  ) {
    // Off, not broken — a key never set, an account out of credit, or a key the
    // API refuses. Each is an honest note rather than an error the member could
    // act on, and each names its own cause so the operator's fix is clear.
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
  return <ReadFromSlip state={state} />
}

/**
 * Presentational add/edit form for one payslip, tagged to the member the section
 * belongs to. The financial year is not typed: it is derived from the payment
 * date — or the pay period's end where the slip states none — and shown back with
 * the date that decided it. The slip is itemised into lines: earnings lines each
 * drawing on one of the member's own taxable inflows, and tax lines each naming
 * the part of the liability they pay. The printed totals stay the member's own
 * figures, an independent cross-check the lines need not sum to.
 *
 * Attaching a document stores it and reads it: the figures it finds pre-fill the
 * fields that are not already the member's own — typed here, or saved on the
 * payslip being edited — and its itemisation fills the earnings and tax lines on
 * the same footing, a kind at a time. An earnings line's inflow is matched from the
 * printed label where that names exactly one of the member's inflows and left unset
 * otherwise, since the slip never names an inflow. A note says the figures were
 * extracted and asks for them to be checked against the document; the figures
 * themselves are what it asks about, so the note does not restate them. Nothing is
 * confirmed by extraction — everything is editable and the member's own save is what
 * persists — so an extraction that is unconfigured, refused, or broken only leaves
 * the form as it was.
 *
 * An inverted pay period (ending before it starts) blocks submission, so the
 * database's own period check is never reached. Persistence lives in the caller.
 */
export function PayslipForm({
  member,
  inflows,
  initialLines = [],
  attachments,
  initial,
  onSubmit,
  onCancel,
}: PayslipFormProps) {
  const memberInflows = inflows.filter((inflow) => inflow.taxable && inflow.member_id === member.id)
  const inflowOptions = memberInflows.map((inflow) => ({ value: inflow.id, label: inflow.name }))
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
  const drafts = usePayslipLineDrafts(initialLines)
  const slip = usePayslipAttachment({
    attachments,
    payslipId: initial?.id ?? null,
    // One read fills the figures and the itemisation together, each under its own
    // rule about what is already the member's.
    onExtracted: (extraction) => ({
      ...fields.prefill(extraction),
      ...drafts.prefill(extraction, inflowOptions),
    }),
  })
  const [note, setNote] = useState(initial?.note ?? '')

  const { values } = fields
  const { lines } = drafts
  const earningDrafts = lines.filter((line) => line.kind === 'earning')
  const taxDrafts = lines.filter((line) => line.kind === 'tax')
  // A half-filled row is a mistake worth catching, and so is a tax line naming
  // nothing it pays; a row with nothing in it at all is simply dropped.
  const enteredLines = lines.filter(lineEntered)
  const linesComplete = enteredLines.every(
    (line) =>
      line.label.trim() !== '' &&
      line.amount !== '' &&
      (line.kind === 'earning' || line.component !== null),
  )
  const sumOfDrafts = (drafts: readonly LineDraft[]) =>
    drafts.reduce((sum, line) => sum + (dollarsToCents(line.amount) ?? 0), 0)
  const allocatedCents = sumOfDrafts(earningDrafts.filter(lineEntered))
  const unallocatedCents = (dollarsToCents(values.gross_cents) ?? 0) - allocatedCents
  const unallocatedTaxCents =
    (dollarsToCents(values.tax_withheld_cents) ?? 0) - sumOfDrafts(taxDrafts.filter(lineEntered))
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
    linesComplete &&
    !slip.busy
  const financialYear =
    values.period_end === null
      ? null
      : financialYearForPayslip({ paidOn: values.paid_on, periodEnd: values.period_end })

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this payslip. Please try again.',
    onSubmit,
    // The stored document belongs to the saved row from here on, so it is no
    // longer cleaned up as an object nothing references.
    onSuccess: slip.keep,
    buildInput: (): PayslipSubmission => ({
      // The id the document is filed under, and the one the row is written
      // under — the same one every time this form saves.
      id: slip.payslipId,
      input: {
        member_id: member.id,
        financial_year: financialYear!,
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
        note: note.trim() === '' ? null : note.trim(),
      } satisfies PayslipInput,
      // Each kind carries only the reference that means anything for it, which is
      // what the stored line's own check constraint requires.
      lines: enteredLines.map((line): PayslipLineInput => ({
        kind: line.kind,
        source_inflow_id: line.kind === 'earning' ? line.sourceInflowId : null,
        tax_component: line.kind === 'tax' ? line.component : null,
        label: line.label.trim(),
        amount_cents: dollarsToCents(line.amount) ?? 0,
      })),
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

      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
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
        <DateInput
          label="Paid on"
          size="sm"
          valueFormat="D MMM YYYY"
          clearable
          placeholder="When the pay landed"
          value={values.paid_on}
          onChange={(value) => fields.setDate('paid_on', value)}
        />
      </SimpleGrid>

      {financialYear !== null && (
        <Text size="xs" c="dimmed">
          {values.paid_on === null
            ? `Filed under FY${financialYear}, derived from the pay period end. Pay is taxed in the year it lands, so entering a payment date files the slip by that instead.`
            : `Filed under FY${financialYear}, derived from the payment date — pay is taxed in the year it lands, whatever period earned it.`}
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

      <Text size="xs" c="dimmed">
        Tax withheld — here and year to date — is the slip’s tax total: PAYG income tax plus any
        STSL study-loan component, not the PAYG line alone. The estimate’s liability already
        includes the HELP repayment that STSL pays, so only the total nets against it. Split it into
        its components under Tax lines below.
      </Text>

      <PayslipEarningsLinesField
        lines={earningDrafts}
        options={inflowOptions}
        allocatedCents={allocatedCents}
        unallocatedCents={unallocatedCents}
        onChange={drafts.change}
        onAdd={() => drafts.add('earning')}
        onRemove={drafts.remove}
      />

      <PayslipTaxLinesField
        lines={taxDrafts}
        unallocatedCents={unallocatedTaxCents}
        onChange={drafts.change}
        onAdd={() => drafts.add('tax')}
        onRemove={drafts.remove}
      />

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
