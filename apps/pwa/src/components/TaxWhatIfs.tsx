import { useState, type ReactNode } from 'react'
import { Accordion, Alert, Badge, Box, Group, NumberInput, Stack, Text } from '@mantine/core'
import {
  familyMedicareLevySurcharge,
  salarySacrificeWhatIf,
  type MemberTaxEstimate,
  type TaxInput,
  type TaxYearConfig,
} from '@nest/tax'
import { dollarsToCents, formatRatePercent, moneyColor } from '../lib/money'
import { MoneyInput } from './MoneyInput'
import { MoneyText } from './MoneyText'

/**
 * Opt-in content behind a borderless, collapsed-by-default accordion toggle. The
 * `label` is the toggle text; the content stays hidden until the user expands it.
 * Shared by the build-up breakdown and the what-if tools so every disclosure on a
 * tax card reads and behaves the same.
 */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
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
export function SalarySacrificePanel({
  input,
  config,
  currentConcessionalCents,
  concessionalCapCents,
}: {
  input: TaxInput
  config: TaxYearConfig
  currentConcessionalCents: number
  concessionalCapCents?: number | undefined
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
 * A household-level Medicare levy surcharge "what-if". It assesses the surcharge
 * as if NEITHER member held private hospital cover — the "what if we drop cover"
 * scenario — running each member's surcharge income through the family MLS math
 * against the family thresholds (raised per dependent child). Against an entered
 * annual policy premium it reports whether cover saves money or costs more than the
 * surcharge it avoids. Dependent-children and premium inputs are ephemeral (local
 * state only, never persisted). The tool sits behind a collapsed toggle, opened
 * on demand, within its own landmark region.
 */
export function MlsWhatIf({
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
  const savingColor = moneyColor(savingCents)

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
            <Stack gap="xxs">
              <Text size="sm">
                Without hospital cover: combined income{' '}
                <MoneyText span cents={result.combinedIncomeForSurchargeCents} /> is in the{' '}
                {formatRatePercent(result.tierRate)} MLS tier ={' '}
                <MoneyText span fw={600} cents={surchargeCents} />
                /yr surcharge.
              </Text>
              {premiumCents > 0 && (
                <Text size="sm" {...(savingColor !== undefined && { c: savingColor })}>
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
