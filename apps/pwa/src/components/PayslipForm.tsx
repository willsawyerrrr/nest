import { useState } from 'react'
import { FileInput, Select, SimpleGrid, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Inflow } from '../hooks/useInflows'
import type { PayslipInput, PayslipRow, PayslipSubmission } from '../hooks/usePayslips'
import { isoDaysBefore, todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { financialYearForPayPeriod } from '../lib/payslips'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

/** Days a fortnightly pay period spans, less the inclusive end day. */
const FORTNIGHT_SPAN_DAYS = 13

interface PayslipFormProps {
  member: { id: string; name: string }
  /** Every household inflow; only this member's taxable ones are offered as the source. */
  inflows: readonly Inflow[]
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
 * Presentational add/edit form for one payslip, tagged to the member the section
 * belongs to. The financial year is not typed: it is derived from the pay period
 * and shown back. The source inflow is an explicit choice from the member's own
 * taxable inflows, and the attached document is uploaded by the caller. An
 * inverted pay period (ending before it starts) blocks submission, so the
 * database's own period check is never reached. Persistence lives in the caller.
 */
export function PayslipForm({ member, inflows, initial, onSubmit, onCancel }: PayslipFormProps) {
  const [periodStart, setPeriodStart] = useState<string | null>(
    initial?.period_start ?? isoDaysBefore(todayIso(), FORTNIGHT_SPAN_DAYS),
  )
  const [periodEnd, setPeriodEnd] = useState<string | null>(initial?.period_end ?? todayIso())
  const [paidOn, setPaidOn] = useState<string | null>(initial?.paid_on ?? null)
  const [gross, setGross] = useState<number | string>(centsToDollars(initial?.gross_cents))
  const [taxWithheld, setTaxWithheld] = useState<number | string>(
    centsToDollars(initial?.tax_withheld_cents),
  )
  const [superAmount, setSuperAmount] = useState<number | string>(
    centsToDollars(initial?.super_cents),
  )
  const [net, setNet] = useState<number | string>(centsToDollars(initial?.net_cents))
  const [salarySacrifice, setSalarySacrifice] = useState<number | string>(
    centsToDollars(initial?.salary_sacrifice_cents),
  )
  const [ytdGross, setYtdGross] = useState<number | string>(
    centsToDollars(initial?.ytd_gross_cents),
  )
  const [ytdTaxWithheld, setYtdTaxWithheld] = useState<number | string>(
    centsToDollars(initial?.ytd_tax_withheld_cents),
  )
  const [ytdSuper, setYtdSuper] = useState<number | string>(
    centsToDollars(initial?.ytd_super_cents),
  )
  const [sourceInflowId, setSourceInflowId] = useState<string | null>(
    initial?.source_inflow_id ?? null,
  )
  const [note, setNote] = useState(initial?.note ?? '')
  const [file, setFile] = useState<File | null>(null)

  const memberInflows = inflows.filter((inflow) => inflow.taxable && inflow.member_id === member.id)
  const periodInverted = periodStart !== null && periodEnd !== null && periodEnd < periodStart
  const quartetEntered = gross !== '' && taxWithheld !== '' && superAmount !== '' && net !== ''
  const canSubmit = periodStart !== null && periodEnd !== null && !periodInverted && quartetEntered
  const financialYear = periodEnd === null ? null : financialYearForPayPeriod(periodEnd)

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this payslip. Please try again.',
    onSubmit,
    buildInput: (): PayslipSubmission => ({
      input: {
        member_id: member.id,
        financial_year: financialYearForPayPeriod(periodEnd!),
        period_start: periodStart!,
        period_end: periodEnd!,
        paid_on: paidOn,
        gross_cents: dollarsToCents(gross) ?? 0,
        tax_withheld_cents: dollarsToCents(taxWithheld) ?? 0,
        super_cents: dollarsToCents(superAmount) ?? 0,
        net_cents: dollarsToCents(net) ?? 0,
        salary_sacrifice_cents: dollarsToCents(salarySacrifice),
        ytd_gross_cents: dollarsToCents(ytdGross),
        ytd_tax_withheld_cents: dollarsToCents(ytdTaxWithheld),
        ytd_super_cents: dollarsToCents(ytdSuper),
        source_inflow_id: sourceInflowId,
        note: note.trim() === '' ? null : note.trim(),
      } satisfies PayslipInput,
      file,
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
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
        <DateInput
          label="Period start"
          size="sm"
          valueFormat="D MMM YYYY"
          clearable
          value={periodStart}
          onChange={setPeriodStart}
        />
        <DateInput
          label="Period end"
          size="sm"
          valueFormat="D MMM YYYY"
          clearable
          value={periodEnd}
          onChange={setPeriodEnd}
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
          value={paidOn}
          onChange={setPaidOn}
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
        <AmountField label="Gross" value={gross} onChange={setGross} />
        <AmountField label="Tax withheld" value={taxWithheld} onChange={setTaxWithheld} />
        <AmountField label="Super" value={superAmount} onChange={setSuperAmount} />
        <AmountField label="Net" value={net} onChange={setNet} />
      </SimpleGrid>

      <AmountField
        label="Salary sacrifice"
        description="Concessional sacrifice shown separately on the slip."
        value={salarySacrifice}
        onChange={setSalarySacrifice}
      />

      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
        <AmountField label="YTD gross" value={ytdGross} onChange={setYtdGross} />
        <AmountField label="YTD tax withheld" value={ytdTaxWithheld} onChange={setYtdTaxWithheld} />
        <AmountField label="YTD super" value={ytdSuper} onChange={setYtdSuper} />
      </SimpleGrid>

      <TextInput
        label="Note"
        size="sm"
        placeholder="e.g. Includes back-pay"
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />

      <FileInput
        label="Payslip document"
        size="sm"
        description={
          initial?.file_path == null
            ? 'Stored privately; the figures above are what drive every variance.'
            : 'Replaces the document already attached.'
        }
        placeholder="Attach the slip"
        accept="image/*,application/pdf"
        clearable
        value={file}
        onChange={setFile}
      />
    </FormShell>
  )
}
