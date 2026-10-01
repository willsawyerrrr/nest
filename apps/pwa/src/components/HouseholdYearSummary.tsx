import { useState } from 'react'
import { Group, NumberInput, Stack, Table, Text, Title } from '@mantine/core'
import {
  householdYearSummary,
  type HouseholdTaxEstimate,
  type MlsTestResult,
  type TaxYearConfig,
} from '@nest/tax'
import type { Member } from '../hooks/useMembers'
import { formatCents, formatRatePercent } from '../lib/money'
import { AppCard } from './AppCard'
import { MoneyText } from './MoneyText'

interface HouseholdYearSummaryProps {
  members: readonly Pick<Member, 'id' | 'name'>[]
  estimate: HouseholdTaxEstimate
  config: TaxYearConfig
  financialYear: number
}

/** A dimmed label over its money figure, right-aligned. */
function FigureLine({ label, cents, fw }: { label: string; cents: number; fw?: number }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed" {...(fw !== undefined && { fw })}>
        {label}
      </Text>
      <MoneyText cents={cents} size="sm" {...(fw !== undefined && { fw })} />
    </Group>
  )
}

/** The MLS verdict line: liable and at what rate, covered, or under the threshold. */
function mlsVerdict(mls: MlsTestResult): string {
  if (mls.liable) {
    return `Liable at ${formatRatePercent(mls.rate)} (tier ${mls.tier})`
  }
  if (mls.tier > 0) {
    return `Over the tier ${mls.tier} threshold, but every member holds private hospital cover`
  }
  return 'Under the family threshold'
}

/**
 * Read-only household view for the selected financial year: combined income,
 * deductions, taxable income, tax, super, and take-home with a per-member
 * breakdown, then the Medicare levy surcharge family-income test — family income,
 * tier, liability, and distance to the next threshold. The dependent-children
 * count is local state, never persisted.
 */
export function HouseholdYearSummary({
  members,
  estimate,
  config,
  financialYear,
}: HouseholdYearSummaryProps) {
  const [dependentChildren, setDependentChildren] = useState(0)
  const summary = householdYearSummary(estimate, dependentChildren, config)
  const { mls } = summary
  const nameOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? 'Member'

  return (
    <AppCard>
      <Stack gap="md" component="section" aria-label="Household">
        <Title order={2} size="h4">
          Household (FY{financialYear})
        </Title>

        <Stack gap={4}>
          <FigureLine label="Gross income" cents={summary.grossIncomeCents} />
          {summary.netCapitalGainCents > 0 && (
            <FigureLine label="of which net capital gain" cents={summary.netCapitalGainCents} />
          )}
          <FigureLine label="Deductions" cents={summary.deductionsCents} />
          <FigureLine label="Concessional super" cents={summary.concessionalSuperCents} />
          <FigureLine label="Taxable income" cents={summary.taxableIncomeCents} fw={600} />
          <FigureLine label="Total tax" cents={summary.taxCents} />
          <FigureLine label="Net take-home" cents={summary.afterTaxCents} fw={700} />
        </Stack>

        <Table.ScrollContainer minWidth={420}>
          <Table aria-label="Household members" withRowBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Member</Table.Th>
                <Table.Th ta="right">Gross</Table.Th>
                <Table.Th ta="right">Taxable</Table.Th>
                <Table.Th ta="right">Tax</Table.Th>
                <Table.Th ta="right">Super</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {summary.members.map((member) => (
                <Table.Tr key={member.memberId}>
                  <Table.Td>{nameOf(member.memberId)}</Table.Td>
                  <Table.Td ta="right">
                    <MoneyText cents={member.grossIncomeCents} size="sm" />
                  </Table.Td>
                  <Table.Td ta="right">
                    <MoneyText cents={member.taxableIncomeCents} size="sm" />
                  </Table.Td>
                  <Table.Td ta="right">
                    <MoneyText cents={member.taxCents} size="sm" />
                  </Table.Td>
                  <Table.Td ta="right">
                    <MoneyText cents={member.concessionalSuperCents} size="sm" />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Stack gap="xs" component="section" aria-label="Medicare levy surcharge test">
          <Title order={3} size="h6">
            Medicare levy surcharge test
          </Title>
          <NumberInput
            label="Dependent children"
            size="sm"
            w={160}
            min={0}
            step={1}
            allowDecimal={false}
            allowNegative={false}
            value={dependentChildren}
            onChange={(value) => setDependentChildren(typeof value === 'number' ? value : 0)}
          />
          <FigureLine label="Family income for MLS" cents={mls.familyIncomeCents} fw={600} />
          <Text size="sm" fw={600}>
            {mlsVerdict(mls)}
          </Text>
          {mls.liable && <FigureLine label="Surcharge" cents={mls.totalSurchargeCents} />}
          {mls.next === null ? (
            <Text size="sm" c="dimmed">
              Already at the top tier.
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {formatCents(mls.next.distanceCents)} to the next threshold at{' '}
              {formatCents(mls.next.floorCents)}.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Family income is taxable income plus reportable super contributions; reportable fringe
            benefits and net investment losses are not recorded.
          </Text>
        </Stack>
      </Stack>
    </AppCard>
  )
}
