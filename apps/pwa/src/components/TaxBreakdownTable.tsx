import { Stack, Table, Text } from '@mantine/core'
import type { TaxBreakdown } from '@nest/tax'
import { DataTable } from './DataTable'
import { MoneyText } from './MoneyText'

/** Fortnights per financial year, for splitting an annual figure. */
const FORTNIGHTS_PER_YEAR = 26

/** A single build-up line: its annual amount and the matching fortnightly share. */
interface ComponentLine {
  /** Plain-language label, abbreviations spelled out. */
  label: string
  annualCents: number
  /** Reduces the running figure (a deduction or offset): rendered as a negative. */
  subtract?: boolean
  /** A core line shown even at zero; others appear only when non-zero. */
  alwaysShow?: boolean
  /** The built-up subtotal or total, emphasised. */
  total?: boolean
}

/** Whether a line appears: core lines and totals always, others only when non-zero. */
function isVisible(line: ComponentLine): boolean {
  return Boolean(line.alwaysShow || line.total || line.annualCents > 0)
}

/** One line's annual and fortnightly figures as a table body row headed by its label. */
function ComponentRow({ label, annualCents, subtract, total }: ComponentLine) {
  const annual = subtract ? -annualCents : annualCents
  const fw = total ? 700 : undefined
  return (
    <Table.Tr>
      <Table.Th scope="row" fw={fw} c={total ? undefined : 'dimmed'}>
        {label}
      </Table.Th>
      <Table.Td ta="right" fw={fw}>
        <MoneyText span cents={annual} />
      </Table.Td>
      <Table.Td ta="right" fw={fw}>
        <MoneyText span cents={Math.round(annual / FORTNIGHTS_PER_YEAR)} />
      </Table.Td>
    </Table.Tr>
  )
}

/** A labelled table of build-up lines with annual and fortnightly columns. */
function ComponentTable({ label, lines }: { label: string; lines: ComponentLine[] }) {
  return (
    <DataTable label={label}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th scope="col" ta="right">
            Annual
          </Table.Th>
          <Table.Th scope="col" ta="right">
            Fortnightly
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {lines.map((line) => (
          <ComponentRow key={line.label} {...line} />
        ))}
      </Table.Tbody>
    </DataTable>
  )
}

/**
 * How a member's gross income becomes the taxable income it is taxed on, then how
 * that tax is built up — each figure annual with its fortnightly share. The first
 * table runs gross income down through any pre-tax deduction (concessional super)
 * to taxable income; the second builds the tax back up. Gross income, taxable
 * income, income tax, Medicare levy, and the total always show; the concessional
 * super deduction, Low Income Tax Offset, Medicare levy surcharge, HELP/HECS
 * repayment, and Division 293 tax appear only when they apply, with any omitted tax
 * components named below so a reader knows they were considered and are nil.
 */
export function BreakdownTable({
  breakdown,
  grossCents,
  concessionalCents,
  deductionsCents,
}: {
  breakdown: TaxBreakdown
  grossCents: number
  concessionalCents: number
  deductionsCents: number
}) {
  const incomeLines: ComponentLine[] = [
    { label: 'Gross income', annualCents: grossCents, alwaysShow: true },
    { label: 'Concessional super', annualCents: concessionalCents, subtract: true },
    { label: 'Deductions', annualCents: deductionsCents, subtract: true },
    { label: 'Taxable income', annualCents: breakdown.taxableIncomeCents, total: true },
  ]
  const taxLines: ComponentLine[] = [
    { label: 'Income tax', annualCents: breakdown.incomeTaxCents, alwaysShow: true },
    { label: 'Low Income Tax Offset', annualCents: breakdown.litoOffsetCents, subtract: true },
    { label: 'Medicare levy', annualCents: breakdown.medicareLevyCents, alwaysShow: true },
    { label: 'Medicare levy surcharge', annualCents: breakdown.medicareLevySurchargeCents },
    { label: 'HELP/HECS repayment', annualCents: breakdown.helpRepaymentCents },
    { label: 'Division 293 tax', annualCents: breakdown.division293Cents },
    { label: 'Total tax', annualCents: breakdown.totalLiabilityCents, total: true },
  ]
  const omitted = taxLines.filter((line) => !isVisible(line))

  return (
    <Stack gap="xs">
      <ComponentTable label="Taxable income" lines={incomeLines.filter(isVisible)} />
      <ComponentTable label="Tax breakdown" lines={taxLines.filter(isVisible)} />
      {omitted.length > 0 && (
        <Text size="xs" c="dimmed">
          Not applicable this year: {omitted.map((line) => line.label).join(', ')}.
        </Text>
      )}
    </Stack>
  )
}
