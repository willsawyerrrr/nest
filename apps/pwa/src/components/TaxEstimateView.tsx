import { useState } from 'react'
import { Alert, Card, Divider, Group, NumberInput, Stack, Table, Text } from '@mantine/core'
import {
  familyMedicareLevySurcharge,
  salarySacrificeWhatIf,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type MemberTaxEstimate,
  type TaxBreakdown,
  type TaxInput,
  type TaxYearConfig,
} from '@nest/tax'
import { dollarsToCents, moneyColor } from '../lib/money'
import { helpPayoffSummary } from '../lib/tax'
import { EmptyState } from './EmptyState'
import { MoneyInput } from './MoneyInput'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface TaxEstimateViewProps {
  estimate: HouseholdTaxEstimate
  financialYear: number
  memberName: (memberId: string) => string
  /** The tax + super config the estimate was computed with; drives the MLS and salary-sacrifice what-ifs. */
  config: TaxYearConfig
  /** Each member's concessional cap (config cap plus carry-forward), keyed by member id, for the what-if headroom warning. */
  concessionalCapCentsByMember?: ReadonlyMap<string, number>
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
      <Table.Td ta="right">
        <MoneyText span cents={grossCents} />
      </Table.Td>
      <Table.Td ta="right">
        <MoneyText span cents={taxCents} />
      </Table.Td>
      <Table.Td ta="right">
        <MoneyText span cents={afterTaxCents} />
      </Table.Td>
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
 * An interactive salary-sacrifice what-if for one member: enter an extra annual
 * pre-tax super contribution and see the tax saved, the amount landing in super
 * (net of the 15% contributions tax), and the drop in take-home cash — the tax
 * saved less the whole amount sacrificed. Re-runs the pure engine on the member's
 * own `input` on every keystroke; the entered amount is ephemeral (local state,
 * never persisted). Warns when the extra sacrifice pushes the member past their
 * concessional cap, and notes any extra Division 293 tax the contribution attracts.
 */
function SalarySacrificePanel({
  input,
  config,
  currentConcessionalCents,
  concessionalCapCents,
}: {
  input: TaxInput
  config: TaxYearConfig
  currentConcessionalCents: number
  concessionalCapCents?: number
}) {
  const [extra, setExtra] = useState<number | string>('')
  const extraCents = dollarsToCents(extra) ?? 0
  const result = salarySacrificeWhatIf(input, extraCents, config)
  const overCap =
    concessionalCapCents !== undefined &&
    extraCents > 0 &&
    currentConcessionalCents + extraCents > concessionalCapCents

  return (
    <Stack gap="xs">
      <Divider />
      <Text fw={600} size="sm">
        Salary sacrifice what-if
      </Text>
      <MoneyInput
        label="Extra salary sacrifice per year"
        size="sm"
        min={0}
        hideControls
        value={extra}
        onChange={setExtra}
      />
      {extraCents > 0 && (
        <Stack gap={2}>
          <Text size="sm">
            Tax saved: <MoneyText span colored cents={result.taxSavedCents} /> / year
          </Text>
          <Text size="sm">
            Into super: <MoneyText span cents={result.netToSuperCents} /> / year{' '}
            <Text span c="dimmed">
              (net of 15% contributions tax)
            </Text>
          </Text>
          <Text size="sm">
            Take-home: <MoneyText span colored cents={result.takeHomeChangeCents} /> / year
          </Text>
          {result.division293DeltaCents > 0 && (
            <Text size="xs" c="dimmed">
              Includes <MoneyText span cents={result.division293DeltaCents} /> extra Division 293
              tax.
            </Text>
          )}
          {overCap && (
            <Alert color="red" variant="light" p="xs">
              <Text size="xs">
                This pushes concessional contributions past the cap (
                <MoneyText span cents={concessionalCapCents} />
                ). The excess is taxed at your marginal rate, not 15%.
              </Text>
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  )
}

/**
 * One row's annual and fortnightly gross/tax/after-tax figures as a compact table.
 * When `breakdown` is given, the income build-up down to taxable income and the
 * component-by-component build-up of the tax are shown above it; `grossCents` and
 * `concessionalCents` feed that income build-up. When `input` and `config` are
 * given, an interactive salary-sacrifice what-if follows the summary.
 */
function FiguresCard({
  name,
  row,
  breakdown,
  concessionalCents = 0,
  deductionsCents = 0,
  input,
  config,
  concessionalCapCents,
  helpPayoff,
}: {
  name: string
  row: Row
  breakdown?: TaxBreakdown
  concessionalCents?: number
  deductionsCents?: number
  input?: TaxInput
  config?: TaxYearConfig
  concessionalCapCents?: number
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
        {input && config && (
          <SalarySacrificePanel
            input={input}
            config={config}
            currentConcessionalCents={concessionalCents}
            concessionalCapCents={concessionalCapCents}
          />
        )}
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
            size="sm"
            min={0}
            step={1}
            allowDecimal={false}
            allowNegative={false}
            value={dependentChildren}
            onChange={(value) => setDependentChildren(typeof value === 'number' ? value : 0)}
          />
          <MoneyInput
            label="Hospital cover premium ($/yr)"
            size="sm"
            min={0}
            hideControls
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
              <MoneyText span cents={result.combinedIncomeForSurchargeCents} /> is in the{' '}
              {formatPercent(result.tierRate)} MLS tier ={' '}
              <MoneyText span fw={600} cents={surchargeCents} />
              /yr surcharge.
            </Text>
            {premiumCents > 0 && (
              <Text size="sm" c={moneyColor(savingCents)}>
                {savingCents > 0 ? (
                  <>
                    Hospital cover saves <MoneyText span cents={savingCents} />
                    /yr over paying the surcharge.
                  </>
                ) : (
                  <>
                    Hospital cover costs <MoneyText span cents={-savingCents} />
                    /yr more than the surcharge.
                  </>
                )}
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
  concessionalCapCentsByMember,
  helpPayoff,
}: TaxEstimateViewProps) {
  return (
    <PageSection title={`Tax estimate (FY${financialYear})`}>
      {estimate.annualGrossCents === 0 ? (
        <EmptyState>
          No income to estimate yet. Add a taxable inflow on the Inflows tab to see a tax estimate.
        </EmptyState>
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
              input={member.input}
              config={config}
              concessionalCapCents={concessionalCapCentsByMember?.get(member.memberId)}
              helpPayoff={helpPayoff?.get(member.memberId)}
            />
          ))}
          <Text size="xs" c="dimmed">
            This estimate excludes capital gains tax, which is not modelled.
          </Text>
        </Stack>
      )}
    </PageSection>
  )
}
