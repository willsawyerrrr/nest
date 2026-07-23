import { useState } from 'react'
import { Card, Group, NumberInput, Stack, Table, Text, Title } from '@mantine/core'
import {
  familyMedicareLevySurcharge,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type MemberTaxEstimate,
  type TaxBreakdown,
  type TaxYearConfig,
} from '@nest/tax'
import { dollarsToCents, formatCents, moneyColor } from '../lib/money'
import { helpPayoffSummary } from '../lib/tax'

interface TaxEstimateViewProps {
  estimate: HouseholdTaxEstimate
  financialYear: number
  memberName: (memberId: string) => string
  config: TaxYearConfig
  /** Each member's HELP/HECS payoff projection, keyed by member id (positive debts only). */
  helpPayoff?: ReadonlyMap<string, HelpPayoffProjection>
}

interface Row {
  annualGrossCents: number
  annualTaxCents: number
  annualAfterTaxCents: number
  fortnightlyGrossCents: number
  fortnightlyTaxCents: number
  fortnightlyAfterTaxCents: number
}

/** Fortnights per financial year, for splitting an annual figure. */
const FORTNIGHTS_PER_YEAR = 26

/** One period's gross/tax/after-tax figures as a table body row headed by the period name. */
function PeriodRow({
  period,
  grossCents,
  taxCents,
  afterTaxCents,
}: {
  period: string
  grossCents: number
  taxCents: number
  afterTaxCents: number
}) {
  return (
    <Table.Tr>
      <Table.Th scope="row" c="dimmed">
        {period}
      </Table.Th>
      <Table.Td ta="right">{formatCents(grossCents)}</Table.Td>
      <Table.Td ta="right">{formatCents(taxCents)}</Table.Td>
      <Table.Td ta="right">{formatCents(afterTaxCents)}</Table.Td>
    </Table.Tr>
  )
}

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
        {formatCents(annual)}
      </Table.Td>
      <Table.Td ta="right" fw={fw}>
        {formatCents(Math.round(annual / FORTNIGHTS_PER_YEAR))}
      </Table.Td>
    </Table.Tr>
  )
}

/** A labelled table of build-up lines with annual and fortnightly columns. */
function ComponentTable({ label, lines }: { label: string; lines: ComponentLine[] }) {
  return (
    <Table.ScrollContainer minWidth={0}>
      <Table fz="sm" verticalSpacing={4} horizontalSpacing="xs" aria-label={label}>
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
      </Table>
    </Table.ScrollContainer>
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
function BreakdownTable({
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

/**
 * One row's annual and fortnightly gross/tax/after-tax figures as a compact table.
 * When `breakdown` is given, the income build-up down to taxable income and the
 * component-by-component build-up of the tax are shown above it; `grossCents` and
 * `concessionalCents` feed that income build-up.
 */
function FiguresCard({
  name,
  row,
  breakdown,
  concessionalCents = 0,
  deductionsCents = 0,
  helpPayoff,
}: {
  name: string
  row: Row
  breakdown?: TaxBreakdown
  concessionalCents?: number
  deductionsCents?: number
  helpPayoff?: HelpPayoffProjection
}) {
  return (
    <Card component="section" aria-label={name} withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Text fw={600}>{name}</Text>
        {breakdown && (
          <BreakdownTable
            breakdown={breakdown}
            grossCents={row.annualGrossCents}
            concessionalCents={concessionalCents}
            deductionsCents={deductionsCents}
          />
        )}
        {helpPayoff && (
          <Text size="xs" c="dimmed">
            {helpPayoffSummary(helpPayoff)}
          </Text>
        )}
        <Table.ScrollContainer minWidth={0}>
          <Table
            fz="sm"
            verticalSpacing={4}
            horizontalSpacing="xs"
            aria-label="Income and tax summary"
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <Table.Th scope="col" ta="right">
                  Gross
                </Table.Th>
                <Table.Th scope="col" ta="right">
                  Tax
                </Table.Th>
                <Table.Th scope="col" ta="right">
                  After tax
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <PeriodRow
                period="Annual"
                grossCents={row.annualGrossCents}
                taxCents={row.annualTaxCents}
                afterTaxCents={row.annualAfterTaxCents}
              />
              <PeriodRow
                period="Fortnightly"
                grossCents={row.fortnightlyGrossCents}
                taxCents={row.fortnightlyTaxCents}
                afterTaxCents={row.fortnightlyAfterTaxCents}
              />
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Card>
  )
}

/** Formats a fractional rate as a trimmed percentage (0.0125 → `1.25%`, 0.01 → `1%`). */
function formatPercent(rate: number): string {
  return `${Number.parseFloat((rate * 100).toFixed(2))}%`
}

/**
 * A household-level Medicare levy surcharge "what-if". It assesses the surcharge
 * as if NEITHER member held private hospital cover — the "what if we drop cover"
 * scenario — running each member's surcharge income through the family MLS math
 * against the family thresholds (raised per dependent child). Against an entered
 * annual policy premium it reports whether cover saves money or costs more than the
 * surcharge it avoids. Dependent-children and premium inputs are ephemeral (local
 * state only, never persisted).
 */
function MlsWhatIf({
  members,
  config,
}: {
  members: readonly MemberTaxEstimate[]
  config: TaxYearConfig
}) {
  const [dependentChildren, setDependentChildren] = useState(0)
  const [premiumDollars, setPremiumDollars] = useState<number | string>(0)

  const result = familyMedicareLevySurcharge(
    members.map((member) => ({
      incomeForSurchargeCents: member.breakdown.incomeForSurchargeCents,
      hasPrivateHospitalCover: false,
    })),
    dependentChildren,
    config,
  )
  const premiumCents = dollarsToCents(premiumDollars) ?? 0
  const surchargeCents = result.totalSurchargeCents
  const savingCents = surchargeCents - premiumCents

  return (
    <Card component="section" aria-label="Private hospital cover" withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Text fw={600}>Private hospital cover vs the Medicare levy surcharge</Text>
        <Group grow align="flex-start">
          <NumberInput
            label="Dependent children"
            min={0}
            step={1}
            allowDecimal={false}
            allowNegative={false}
            value={dependentChildren}
            onChange={(value) => setDependentChildren(typeof value === 'number' ? value : 0)}
          />
          <NumberInput
            label="Hospital cover premium ($/yr)"
            min={0}
            step={100}
            prefix="$"
            thousandSeparator=","
            allowNegative={false}
            value={premiumDollars}
            onChange={setPremiumDollars}
          />
        </Group>
        {result.tierRate === 0 ? (
          <Text size="sm" c="dimmed">
            Below the family MLS threshold — no surcharge applies.
          </Text>
        ) : (
          <Stack gap={4}>
            <Text size="sm">
              Without hospital cover: combined income{' '}
              {formatCents(result.combinedIncomeForSurchargeCents)} is in the{' '}
              {formatPercent(result.tierRate)} MLS tier ={' '}
              <Text span fw={600}>
                {formatCents(surchargeCents)}/yr
              </Text>{' '}
              surcharge.
            </Text>
            {premiumCents > 0 && (
              <Text size="sm" c={moneyColor(savingCents)}>
                {savingCents > 0
                  ? `Hospital cover saves ${formatCents(savingCents)}/yr over paying the surcharge.`
                  : `Hospital cover costs ${formatCents(-savingCents)}/yr more than the surcharge.`}
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

/** Presentational household tax estimate: household and per-member annual/fortnightly figures. */
export function TaxEstimateView({
  estimate,
  financialYear,
  memberName,
  config,
  helpPayoff,
}: TaxEstimateViewProps) {
  return (
    <Stack gap="md">
      <Title order={2} visibleFrom="sm">
        Tax estimate (FY{financialYear})
      </Title>

      {estimate.annualGrossCents === 0 ? (
        <Text c="dimmed">
          No income to estimate yet. Add a taxable inflow on the Inflows tab to see a tax estimate.
        </Text>
      ) : (
        <Stack gap="sm">
          <FiguresCard name="Household" row={estimate} />
          <MlsWhatIf members={estimate.members} config={config} />
          {estimate.members.map((member) => (
            <FiguresCard
              key={member.memberId}
              name={memberName(member.memberId)}
              row={member}
              breakdown={member.breakdown}
              concessionalCents={member.annualConcessionalContributionsCents}
              deductionsCents={member.annualDeductionsCents}
              helpPayoff={helpPayoff?.get(member.memberId)}
            />
          ))}
          <Text size="xs" c="dimmed">
            This estimate excludes capital gains tax, which is not modelled.
          </Text>
        </Stack>
      )}
    </Stack>
  )
}
