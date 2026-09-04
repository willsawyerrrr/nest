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
  /**
   * An indented sub-line detailing part of the line above (e.g. projected
   * interest inside gross income): carries no sign and joins no running total.
   */
  detail?: boolean
}

/** Whether a line appears: core lines and totals always, others only when non-zero. */
function isVisible(line: ComponentLine): boolean {
  return Boolean(line.alwaysShow || line.total || line.annualCents > 0)
}

/** One line's annual and fortnightly figures as a table body row headed by its label. */
function ComponentRow({ label, annualCents, subtract, total, detail }: ComponentLine) {
  const annual = subtract ? -annualCents : annualCents
  const fw = total ? 700 : undefined
  return (
    <Table.Tr>
      <Table.Th scope="row" fw={fw} {...(!total && { c: 'dimmed' })} {...(detail && { pl: 'md' })}>
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
    <DataTable label={label} layout="fixed">
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th scope="col" ta="right" w="30%">
            Annual
          </Table.Th>
          <Table.Th scope="col" ta="right" w="30%">
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
 * super deduction, the tax-free part of a one-off, Low Income Tax Offset, the
 * termination-payment offset, Medicare levy surcharge, HELP/HECS repayment, and
 * Division 293 tax appear only when they apply, with any omitted tax components
 * named below so a reader knows they were considered and are nil.
 *
 * A ONE-OFF's tax-free part is a line of the income build-up rather than something
 * netted out of gross income, so the gross stays the money that actually arrived and
 * the concession is visible as the concession it is. The gross it is part of is named
 * below the tables, because every fortnightly figure on the card is derived net of
 * one-off money and a reader comparing the two columns would otherwise read the gap
 * as an error.
 *
 * Projected savings interest is already inside gross income (the tax estimate
 * counts it as `other` income), so it shows as an indented detail line under
 * gross rather than a step in the running total.
 */
export function BreakdownTable({
  breakdown,
  grossCents,
  concessionalCents,
  deductionsCents,
  oneOffGrossCents = 0,
  oneOffTaxFreeCents = 0,
  projectedInterestCents = 0,
}: {
  breakdown: TaxBreakdown
  grossCents: number
  concessionalCents: number
  deductionsCents: number
  /** Gross one-off money inside `grossCents`, for the note below the tables. */
  oneOffGrossCents?: number
  /** The part of it excluded from assessable income entirely — a redundancy's tax-free amount. */
  oneOffTaxFreeCents?: number
  /** Projected annual savings interest inside `grossCents`, shown as a detail line. */
  projectedInterestCents?: number
}) {
  const incomeLines: ComponentLine[] = [
    { label: 'Gross income', annualCents: grossCents, alwaysShow: true },
    {
      label: 'Investment income (projected)',
      annualCents: projectedInterestCents,
      detail: true,
    },
    { label: 'Tax-free one-off payments', annualCents: oneOffTaxFreeCents, subtract: true },
    { label: 'Concessional super', annualCents: concessionalCents, subtract: true },
    { label: 'Deductions', annualCents: deductionsCents, subtract: true },
    { label: 'Taxable income', annualCents: breakdown.taxableIncomeCents, total: true },
  ]
  const taxLines: ComponentLine[] = [
    { label: 'Income tax', annualCents: breakdown.incomeTaxCents, alwaysShow: true },
    { label: 'Low Income Tax Offset', annualCents: breakdown.litoOffsetCents, subtract: true },
    {
      label: 'Termination payment offset',
      annualCents: breakdown.oneOffOffsetCents,
      subtract: true,
    },
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
      {oneOffGrossCents > 0 && (
        <Text size="xs" c="dimmed">
          Gross income includes <MoneyText span cents={oneOffGrossCents} /> of one-off payments. The
          card’s fortnightly figures leave them out — money that lands once has no fortnightly share
          of its own.
        </Text>
      )}
      <ComponentTable label="Tax breakdown" lines={taxLines.filter(isVisible)} />
      {omitted.length > 0 && (
        <Text size="xs" c="dimmed">
          Not applicable this year: {omitted.map((line) => line.label).join(', ')}.
        </Text>
      )}
    </Stack>
  )
}
