import { useState } from 'react'
import { Card, Group, NumberInput, Stack, Text } from '@mantine/core'
import { projectSuperBalance } from '@nest/plan'
import type { Member } from '../hooks/useMembers'
import { formatCents } from '../lib/money'
import {
  ASSUMPTIONS_STORAGE_KEY,
  readAssumptions,
  readMemberAges,
  setMemberAge,
  toProjectionInput,
  writeAssumptions,
  yearsToRetirement,
  type RetirementAssumptions,
} from '../lib/retirement'

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

/** A labelled figure stacked label-over-value, for the projection summary rows. */
function Figure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={emphasis ? 700 : 600} size={emphasis ? 'lg' : 'sm'}>
        {value}
      </Text>
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
    <Card withBorder radius="md" p="sm">
      <Stack gap="xs">
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
            <Group gap="lg" wrap="wrap">
              <Figure
                label="Years to retirement"
                value={String(yearsToRetirement(age!, assumptions.retirementAge))}
              />
              <Figure label="Current balance" value={formatCents(currentBalanceCents)} />
              <Figure
                label="Est. net contribution / yr"
                value={formatCents(netAnnualContributionCents)}
              />
            </Group>
            <Group gap="lg" wrap="wrap" align="flex-end">
              <Figure
                label="Projected at retirement (today's dollars)"
                value={formatCents(projection.realCents)}
                emphasis
              />
              <Figure label="Nominal" value={formatCents(projection.nominalCents)} />
            </Group>
          </>
        )}
      </Stack>
    </Card>
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

      <Card withBorder radius="md" p="sm">
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Assumptions
          </Text>
          <Group gap="sm" grow wrap="wrap">
            <NumberInput
              label="Retirement age"
              size="xs"
              min={0}
              max={120}
              hideControls
              value={assumptions.retirementAge}
              onChange={(value) => updateAssumption('retirementAge', value)}
            />
            <NumberInput
              label="Expected return"
              size="xs"
              suffix="%"
              min={0}
              decimalScale={2}
              hideControls
              value={assumptions.expectedReturnPct}
              onChange={(value) => updateAssumption('expectedReturnPct', value)}
            />
            <NumberInput
              label="Inflation"
              size="xs"
              suffix="%"
              min={0}
              decimalScale={2}
              hideControls
              value={assumptions.inflationPct}
              onChange={(value) => updateAssumption('inflationPct', value)}
            />
            <NumberInput
              label="Contribution growth"
              size="xs"
              suffix="%"
              min={0}
              decimalScale={2}
              hideControls
              value={assumptions.contributionGrowthPct}
              onChange={(value) => updateAssumption('contributionGrowthPct', value)}
            />
          </Group>
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
