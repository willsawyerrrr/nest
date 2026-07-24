import { useState, type ReactNode } from 'react'
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Card,
  Group,
  NumberInput,
  Progress,
  rem,
  Stack,
  Text,
} from '@mantine/core'
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
import { BreakdownTable } from './TaxBreakdownTable'
import { TaxWaterfall } from './TaxWaterfall'

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
}: {
  label: string
  fortnightlyCents: number
  annualCents: number
}) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Group gap={4} align="baseline" wrap="nowrap">
        <MoneyText cents={fortnightlyCents} fw={600} size="sm" />
        <Text size="xs" c="dimmed">
          / fn
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        <MoneyText span cents={annualCents} /> / year
      </Text>
    </Stack>
  )
}

/**
 * The card's headline: the take-home pay led by the fortnightly figure (the app's
 * primary cadence) in large display type, the annual beneath as a dimmed
 * secondary, with gross and total tax as smaller supporting figures alongside.
 */
function HeroFigures({ row }: { row: Row }) {
  return (
    <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
          Take-home
        </Text>
        <Group gap={6} align="baseline" wrap="nowrap">
          <MoneyText
            cents={row.fortnightlyAfterTaxCents}
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
          <MoneyText span cents={row.annualAfterTaxCents} /> / year
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
        />
      </Group>
    </Group>
  )
}

/**
 * Opt-in content behind a borderless, collapsed-by-default accordion toggle. The
 * `label` is the toggle text; the content stays hidden until the user expands it.
 * Shared by the build-up breakdown and the what-if tools so every disclosure on a
 * tax card reads and behaves the same.
 */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Accordion chevronPosition="right" styles={{ content: { paddingInline: 0 } }}>
      <Accordion.Item value="disclosure" style={{ border: 'none' }}>
        <Accordion.Control px={0}>
          <Text size="sm" fw={600}>
            {label}
          </Text>
        </Accordion.Control>
        <Accordion.Panel>{children}</Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}

/**
 * A subtly brand-accented panel that frames an interactive what-if tool, marking
 * it off from the read-only figures around it. A "What-if" badge and the tool's
 * title head the panel.
 */
function WhatIfPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack
      gap="xs"
      p="sm"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        borderLeft: '3px solid var(--mantine-color-brand-5)',
        backgroundColor: 'var(--mantine-primary-color-light)',
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <Badge color="brand" variant="light" size="xs">
          What-if
        </Badge>
        <Text fw={600} size="sm">
          {title}
        </Text>
      </Group>
      {children}
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
    <WhatIfPanel title="Salary sacrifice">
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
    </WhatIfPanel>
  )
}

/**
 * One member's (or the household's) tax estimate card, led by the take-home
 * headline, gross and total tax supporting figures, and a take-home-versus-tax
 * bar. When `breakdown` is given, the full income and tax build-up sits behind a
 * collapsed "Show breakdown" accordion; `grossCents` and `concessionalCents` feed
 * that build-up. When `input` and `config` are given, an interactive salary-
 * sacrifice what-if sits behind its own collapsed toggle.
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
    <Card component="section" aria-label={name} withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={600}>{name}</Text>
        <HeroFigures row={row} />
        <TaxBiteBar
          label={name}
          afterTaxCents={row.annualAfterTaxCents}
          grossCents={row.annualGrossCents}
        />
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
 * state only, never persisted). The tool sits behind a collapsed toggle, opened
 * on demand, within its own landmark region.
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
    <Box component="section" aria-label="Private hospital cover">
      <Disclosure label="Private hospital cover what-if">
        <WhatIfPanel title="Private hospital cover vs the Medicare levy surcharge">
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
        </WhatIfPanel>
      </Disclosure>
    </Box>
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
