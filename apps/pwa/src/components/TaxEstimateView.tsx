import { Box, Card, Group, Progress, rem, Stack, Text } from '@mantine/core'
import {
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type TaxBreakdown,
  type TaxInput,
  type TaxYearConfig,
} from '@nest/tax'
import { helpPayoffSummary } from '../lib/tax'
import { ComparedAmount } from './ComparedAmount'
import { EmptyState } from './EmptyState'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { BreakdownTable } from './TaxBreakdownTable'
import { TaxWaterfall } from './TaxWaterfall'
import { Disclosure, MlsWhatIf, SalarySacrificePanel } from './TaxWhatIfs'
import { WithholdingPosition } from './WithholdingPosition'

interface TaxEstimateViewProps {
  estimate: HouseholdTaxEstimate
  /**
   * The same estimate from the real (un-sandboxed) inflows. Supplied while
   * planning mode is active; each card's take-home, total tax, and withholding
   * balance then show their `real → proposed (±Δ)` move.
   */
  baseline?: HouseholdTaxEstimate
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
  /** Gross one-off money inside the annual figures, and out of the fortnightly ones. */
  annualOneOffGrossCents: number
  fortnightlyGrossCents: number
  fortnightlyTaxCents: number
  fortnightlyAfterTaxCents: number
}

/** The whole-percentage split of gross into take-home and tax, or 0/0 when gross is nil. */
function takeHomeSplit(
  afterTaxCents: number,
  grossCents: number,
): {
  takeHomePct: number
  taxPct: number
} {
  if (grossCents <= 0) {
    return { takeHomePct: 0, taxPct: 0 }
  }
  const takeHomePct = Math.round((afterTaxCents / grossCents) * 100)
  return { takeHomePct, taxPct: 100 - takeHomePct }
}

/** A colour swatch and its labelled share, for the tax-bite bar's mini legend. */
function LegendItem({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box
        w={10}
        h={10}
        style={{ borderRadius: 'var(--mantine-radius-xs)', backgroundColor: color }}
      />
      <Text size="xs" c="dimmed" fw={500}>
        {`${label} ${pct}%`}
      </Text>
    </Group>
  )
}

/**
 * A slim horizontal bar splitting gross income into its take-home and tax shares —
 * take-home in the positive tone, tax in the negative tone — with a small legend
 * naming each share as a percentage, so the key ratio reads at a glance.
 */
function TaxBiteBar({
  label,
  afterTaxCents,
  grossCents,
}: {
  label: string
  afterTaxCents: number
  grossCents: number
}) {
  const { takeHomePct, taxPct } = takeHomeSplit(afterTaxCents, grossCents)
  return (
    <Stack gap={6}>
      <Progress.Root size="lg" radius="sm" aria-label={`${label} take-home versus tax`}>
        <Progress.Section value={takeHomePct} color="positive" />
        <Progress.Section value={taxPct} color="negative" />
      </Progress.Root>
      <Group gap="lg" wrap="nowrap">
        <LegendItem
          color="var(--mantine-color-positive-filled)"
          label="Take-home"
          pct={takeHomePct}
        />
        <LegendItem color="var(--mantine-color-negative-filled)" label="Tax" pct={taxPct} />
      </Group>
    </Stack>
  )
}

/** A supporting figure: a dimmed label over its fortnightly amount, with the annual beneath. */
function SupportFigure({
  label,
  fortnightlyCents,
  annualCents,
  baselineFortnightlyCents,
  baselineAnnualCents,
}: {
  label: string
  fortnightlyCents: number
  annualCents: number
  baselineFortnightlyCents?: number | undefined
  baselineAnnualCents?: number | undefined
}) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Group gap="xxs" align="baseline" wrap="nowrap">
        <ComparedAmount
          baselineCents={baselineFortnightlyCents ?? fortnightlyCents}
          proposedCents={fortnightlyCents}
          fw={600}
          size="sm"
        />
        <Text size="xs" c="dimmed">
          / fn
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        <ComparedAmount
          span
          baselineCents={baselineAnnualCents ?? annualCents}
          proposedCents={annualCents}
        />{' '}
        / year
      </Text>
    </Stack>
  )
}

/**
 * Why the card's annual and fortnightly figures deliberately disagree where one-off
 * money lands in the year: the annual ones are the whole year's truth and the
 * fortnightly ones are derived net of the one-offs, a payment that lands once having
 * no fortnightly share to plan against. Without this a reader multiplying the
 * fortnightly figure by 26 would read the gap as an error.
 */
function OneOffNote({ oneOffGrossCents }: { oneOffGrossCents: number }) {
  return (
    <Text size="xs" c="dimmed">
      Includes <MoneyText span cents={oneOffGrossCents} /> of one-off money in the annual figures.
      The fortnightly ones leave it out, so the plan is a statement about the pay that recurs.
    </Text>
  )
}

/**
 * The card's headline: the take-home pay led by the fortnightly figure (the app's
 * primary cadence) in large display type, the annual beneath as a dimmed
 * secondary, with gross and total tax as smaller supporting figures alongside.
 */
function HeroFigures({ row, baselineRow }: { row: Row; baselineRow?: Row | undefined }) {
  return (
    <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
          Take-home
        </Text>
        <Group gap={6} align="baseline" wrap="nowrap">
          <ComparedAmount
            baselineCents={baselineRow?.fortnightlyAfterTaxCents ?? row.fortnightlyAfterTaxCents}
            proposedCents={row.fortnightlyAfterTaxCents}
            fw={700}
            lh={1.1}
            fz={rem(30)}
            style={{ fontFamily: 'var(--mantine-font-family-headings)' }}
          />
          <Text size="sm" c="dimmed">
            / fn
          </Text>
        </Group>
        <Text size="sm" c="dimmed">
          <ComparedAmount
            span
            baselineCents={baselineRow?.annualAfterTaxCents ?? row.annualAfterTaxCents}
            proposedCents={row.annualAfterTaxCents}
          />{' '}
          / year
        </Text>
      </Stack>
      <Group gap="xl" wrap="wrap">
        <SupportFigure
          label="Gross"
          fortnightlyCents={row.fortnightlyGrossCents}
          annualCents={row.annualGrossCents}
        />
        <SupportFigure
          label="Total tax"
          fortnightlyCents={row.fortnightlyTaxCents}
          annualCents={row.annualTaxCents}
          baselineFortnightlyCents={baselineRow?.fortnightlyTaxCents}
          baselineAnnualCents={baselineRow?.annualTaxCents}
        />
      </Group>
    </Group>
  )
}

/**
 * One member's (or the household's) tax estimate card, led by the take-home
 * headline, gross and total tax supporting figures, and a take-home-versus-tax
 * bar. When `breakdown` is given, the full income and tax build-up sits behind a
 * collapsed "Show breakdown" accordion; `grossCents` and `concessionalCents` feed
 * that build-up, and the withholding position appears above it once payslips have
 * recorded any. When `input` and `config` are given, an interactive salary-
 * sacrifice what-if sits behind its own collapsed toggle.
 */
function FiguresCard({
  name,
  row,
  baselineRow,
  breakdown,
  baselineBreakdown,
  concessionalCents = 0,
  deductionsCents = 0,
  input,
  config,
  concessionalCapCents,
  helpPayoff,
  oneOffTaxFreeCents = 0,
}: {
  name: string
  row: Row
  baselineRow?: Row | undefined
  breakdown?: TaxBreakdown
  baselineBreakdown?: TaxBreakdown | undefined
  concessionalCents?: number
  deductionsCents?: number
  input?: TaxInput
  config?: TaxYearConfig
  concessionalCapCents?: number | undefined
  helpPayoff?: HelpPayoffProjection | undefined
  /** A one-off's amount excluded from assessable income entirely, for the build-up. */
  oneOffTaxFreeCents?: number
}) {
  return (
    <Card component="section" aria-label={name} withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={600}>{name}</Text>
        <HeroFigures row={row} baselineRow={baselineRow} />
        {row.annualOneOffGrossCents > 0 && (
          <OneOffNote oneOffGrossCents={row.annualOneOffGrossCents} />
        )}
        <TaxBiteBar
          label={name}
          afterTaxCents={row.annualAfterTaxCents}
          grossCents={row.annualGrossCents}
        />
        {breakdown && breakdown.paygWithheldCents > 0 && (
          <WithholdingPosition breakdown={breakdown} baseline={baselineBreakdown} />
        )}
        {helpPayoff && (
          <Text size="xs" c="dimmed">
            {helpPayoffSummary(helpPayoff)}
          </Text>
        )}
        {breakdown && (
          <Disclosure label="Show breakdown">
            <Stack gap="md">
              <TaxWaterfall
                grossCents={row.annualGrossCents}
                deductionsCents={deductionsCents}
                concessionalCents={concessionalCents}
                breakdown={breakdown}
                afterTaxCents={row.annualAfterTaxCents}
              />
              <BreakdownTable
                breakdown={breakdown}
                grossCents={row.annualGrossCents}
                concessionalCents={concessionalCents}
                deductionsCents={deductionsCents}
                oneOffGrossCents={row.annualOneOffGrossCents}
                oneOffTaxFreeCents={oneOffTaxFreeCents}
              />
            </Stack>
          </Disclosure>
        )}
        {input && config && (
          <Disclosure label="Salary sacrifice what-if">
            <SalarySacrificePanel
              input={input}
              config={config}
              currentConcessionalCents={concessionalCents}
              concessionalCapCents={concessionalCapCents}
            />
          </Disclosure>
        )}
      </Stack>
    </Card>
  )
}

/** Presentational household tax estimate: household and per-member annual/fortnightly figures. */
export function TaxEstimateView({
  estimate,
  baseline,
  financialYear,
  memberName,
  config,
  concessionalCapCentsByMember,
  helpPayoff,
}: TaxEstimateViewProps) {
  const baselineMemberById = new Map(
    (baseline?.members ?? []).map((member) => [member.memberId, member]),
  )
  return (
    <PageSection title={`Tax estimate (FY${financialYear})`}>
      {estimate.annualGrossCents === 0 ? (
        <EmptyState>
          No income to estimate yet. Add a taxable inflow on the Inflows tab to see a tax estimate.
        </EmptyState>
      ) : (
        <Stack gap="sm">
          <FiguresCard name="Household" row={estimate} baselineRow={baseline} />
          <MlsWhatIf members={estimate.members} config={config} />
          {estimate.members.map((member) => (
            <FiguresCard
              key={member.memberId}
              name={memberName(member.memberId)}
              row={member}
              baselineRow={baselineMemberById.get(member.memberId)}
              breakdown={member.breakdown}
              baselineBreakdown={baselineMemberById.get(member.memberId)?.breakdown}
              concessionalCents={member.annualConcessionalContributionsCents}
              deductionsCents={member.annualDeductionsCents}
              input={member.input}
              config={config}
              concessionalCapCents={concessionalCapCentsByMember?.get(member.memberId)}
              helpPayoff={helpPayoff?.get(member.memberId)}
              oneOffTaxFreeCents={
                member.annualOneOffGrossCents -
                member.input.assessableIncome.employmentTerminationCents
              }
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
