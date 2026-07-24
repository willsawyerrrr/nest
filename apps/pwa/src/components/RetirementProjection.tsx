import { useState } from 'react'
import {
  Box,
  Card,
  Group,
  NumberInput,
  Progress,
  rem,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core'
import {
  projectSuperBalance,
  toProjectionInput,
  yearsToRetirement,
  type RetirementAssumptions,
} from '@nest/plan'
import type { Member } from '../hooks/useMembers'
import { formatCents, formatPerYear } from '../lib/money'
import {
  ASSUMPTIONS_STORAGE_KEY,
  readAssumptions,
  readMemberAges,
  setMemberAge,
  writeAssumptions,
} from '../lib/retirement'
import { MoneyText } from './MoneyText'

/** A member's inputs to their retirement projection: balance and net annual contribution. */
interface RetirementProjectionEntry {
  member: Member
  currentBalanceCents: number
  netAnnualContributionCents: number
}

interface RetirementProjectionProps {
  entries: RetirementProjectionEntry[]
  /** Default retirement age when the household has not set one — the preservation age. */
  preservationAge: number
}

/** A labelled figure stacked label-over-value, for the projection's supporting rows. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text fw={600} size="sm">
        {value}
      </Text>
    </Stack>
  )
}

/** The whole-percentage split of the projected nominal balance into its current and grown shares. */
function growthShare(
  currentBalanceCents: number,
  nominalCents: number,
): {
  currentPct: number
  growthPct: number
} {
  if (nominalCents <= 0) {
    return { currentPct: 0, growthPct: 0 }
  }
  const currentPct = Math.min(100, Math.round((currentBalanceCents / nominalCents) * 100))
  return { currentPct, growthPct: 100 - currentPct }
}

/**
 * The growth bar: the current balance (brand) and its projected growth (positive
 * tone) as shares of the nominal balance at retirement, captioned "now" at the
 * balance today and "at <retirement age>" at the projected balance, so the growth
 * over time reads at a glance.
 */
function GrowthBar({
  memberName,
  currentBalanceCents,
  nominalCents,
  retirementAge,
}: {
  memberName: string
  currentBalanceCents: number
  nominalCents: number
  retirementAge: number
}) {
  const { currentPct, growthPct } = growthShare(currentBalanceCents, nominalCents)
  return (
    <Stack gap={6}>
      <Progress.Root size="lg" radius="sm" aria-label={`${memberName} balance growth`}>
        <Progress.Section value={currentPct} color="brand" />
        <Progress.Section value={growthPct} color="positive" />
      </Progress.Root>
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={0}>
          <Text size="xs" c="dimmed">
            Now
          </Text>
          <MoneyText cents={currentBalanceCents} size="sm" fw={600} />
        </Stack>
        <Stack gap={0} align="flex-end">
          <Text size="xs" c="dimmed">
            At {retirementAge}
          </Text>
          <MoneyText cents={nominalCents} size="sm" fw={600} />
        </Stack>
      </Group>
    </Stack>
  )
}

/** One member's projection card: age input, then their projected balance at retirement. */
function MemberProjectionCard({
  entry,
  age,
  assumptions,
  onAgeChange,
}: {
  entry: RetirementProjectionEntry
  age: number | undefined
  assumptions: RetirementAssumptions
  onAgeChange: (age: number | null) => void
}) {
  const { member, currentBalanceCents, netAnnualContributionCents } = entry
  const projection =
    age === undefined
      ? null
      : projectSuperBalance(
          toProjectionInput(currentBalanceCents, netAnnualContributionCents, age, assumptions),
        )

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text fw={600}>{member.name}</Text>
          <NumberInput
            aria-label={`${member.name} current age`}
            label="Current age"
            size="xs"
            min={0}
            max={120}
            hideControls
            w={110}
            value={age ?? ''}
            onChange={(value) => onAgeChange(value === '' ? null : Number(value))}
          />
        </Group>

        {projection === null ? (
          <Text size="sm" c="dimmed">
            Enter {member.name}&rsquo;s current age to project their balance at retirement.
          </Text>
        ) : (
          <>
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
                  Projected at retirement
                </Text>
                <MoneyText
                  cents={projection.realCents}
                  fw={700}
                  lh={1.1}
                  fz={rem(30)}
                  style={{ fontFamily: 'var(--mantine-font-family-headings)' }}
                />
                <Text size="sm" c="dimmed">
                  in today&rsquo;s dollars
                </Text>
              </Stack>
              <Figure label="Nominal" value={formatCents(projection.nominalCents)} />
            </Group>

            <GrowthBar
              memberName={member.name}
              currentBalanceCents={currentBalanceCents}
              nominalCents={projection.nominalCents}
              retirementAge={assumptions.retirementAge}
            />

            <SimpleGrid cols={2} spacing="md" verticalSpacing="xs">
              <Figure
                label="Years to retirement"
                value={String(yearsToRetirement(age!, assumptions.retirementAge))}
              />
              <Figure
                label="Est. net contribution"
                value={formatPerYear(netAnnualContributionCents)}
              />
            </SimpleGrid>
          </>
        )}
      </Stack>
    </Card>
  )
}

/** One assumption input, a compact percentage or age `NumberInput` in the cluster. */
function AssumptionInput({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (value: number | string) => void
}) {
  return (
    <NumberInput
      label={label}
      size="xs"
      suffix={suffix}
      min={0}
      max={suffix ? undefined : 120}
      decimalScale={suffix ? 2 : undefined}
      hideControls
      value={value}
      onChange={onChange}
    />
  )
}

/**
 * The household's retirement projection: shared return/inflation/growth and
 * retirement-age assumptions (persisted in localStorage), then a per-member card
 * projecting their current balance plus net annual contributions to retirement,
 * shown in both today's dollars and nominal. Age is entered per member; all
 * figures are estimates.
 */
export function RetirementProjection({ entries, preservationAge }: RetirementProjectionProps) {
  const [assumptions, setAssumptions] = useState<RetirementAssumptions>(() => {
    const stored = readAssumptions()
    // Default the retirement age to the preservation age until the household sets one.
    return localStorage.getItem(ASSUMPTIONS_STORAGE_KEY)
      ? stored
      : { ...stored, retirementAge: preservationAge }
  })
  const [ages, setAges] = useState<Record<string, number>>(readMemberAges)

  const updateAssumption = (field: keyof RetirementAssumptions, value: number | string) => {
    const next = { ...assumptions, [field]: value === '' ? 0 : Number(value) }
    setAssumptions(next)
    writeAssumptions(next)
  }

  const updateAge = (memberId: string, age: number | null) => {
    setAges((current) => setMemberAge(current, memberId, age))
  }

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Retirement projection
      </Text>
      <Text c="dimmed" size="xs">
        Estimates only, based on the assumptions below. Assumptions are shared and saved on this
        device; each member&rsquo;s age is entered on their card.
      </Text>

      <Card
        withBorder
        radius="md"
        p="sm"
        style={{ borderLeft: '3px solid var(--mantine-color-brand-5)' }}
      >
        <Stack gap="xs">
          <Group gap="xs" wrap="nowrap">
            <Box
              w={8}
              h={8}
              style={{
                borderRadius: '50%',
                backgroundColor: 'var(--mantine-color-brand-5)',
              }}
            />
            <Text fw={600} size="sm">
              Assumptions
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <AssumptionInput
              label="Retirement age"
              value={assumptions.retirementAge}
              onChange={(value) => updateAssumption('retirementAge', value)}
            />
            <AssumptionInput
              label="Expected return"
              suffix="%"
              value={assumptions.expectedReturnPct}
              onChange={(value) => updateAssumption('expectedReturnPct', value)}
            />
            <AssumptionInput
              label="Inflation"
              suffix="%"
              value={assumptions.inflationPct}
              onChange={(value) => updateAssumption('inflationPct', value)}
            />
            <AssumptionInput
              label="Contribution growth"
              suffix="%"
              value={assumptions.contributionGrowthPct}
              onChange={(value) => updateAssumption('contributionGrowthPct', value)}
            />
          </SimpleGrid>
        </Stack>
      </Card>

      {entries.map((entry) => (
        <MemberProjectionCard
          key={entry.member.id}
          entry={entry}
          age={ages[entry.member.id]}
          assumptions={assumptions}
          onAgeChange={(age) => updateAge(entry.member.id, age)}
        />
      ))}
    </Stack>
  )
}
