import { Card, Group, Stack, Text, Title } from '@mantine/core'
import type { HouseholdTaxEstimate } from '@budget/tax'
import { formatCents } from '../lib/money'

interface TaxEstimateViewProps {
  estimate: HouseholdTaxEstimate
  financialYear: number
  memberName: (memberId: string) => string
}

interface Row {
  annualGrossCents: number
  annualTaxCents: number
  annualAfterTaxCents: number
  fortnightlyGrossCents: number
  fortnightlyTaxCents: number
  fortnightlyAfterTaxCents: number
}

const FIELDS: { label: string; key: keyof Row }[] = [
  { label: 'Annual gross', key: 'annualGrossCents' },
  { label: 'Annual tax', key: 'annualTaxCents' },
  { label: 'Annual after tax', key: 'annualAfterTaxCents' },
  { label: 'Fortnightly gross', key: 'fortnightlyGrossCents' },
  { label: 'Fortnightly tax', key: 'fortnightlyTaxCents' },
  { label: 'Fortnightly after tax', key: 'fortnightlyAfterTaxCents' },
]

/** One row's annual and fortnightly gross/tax/after-tax figures as label + value pairs. */
function FiguresCard({ name, row }: { name: string; row: Row }) {
  return (
    <Card component="section" aria-label={name} withBorder radius="md" p="sm">
      <Stack gap={4}>
        <Text fw={600}>{name}</Text>
        {FIELDS.map((field) => (
          <Group key={field.key} justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {field.label}
            </Text>
            <Text fw={600} size="sm">
              {formatCents(row[field.key])}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}

/** Presentational household tax estimate: household and per-member annual/fortnightly figures. */
export function TaxEstimateView({ estimate, financialYear, memberName }: TaxEstimateViewProps) {
  return (
    <Stack gap="md">
      <Title order={2}>Tax estimate (FY{financialYear})</Title>

      {estimate.annualGrossCents === 0 ? (
        <Text c="dimmed">
          No income to estimate yet. Add a taxable inflow on the Inflows tab to see a tax estimate.
        </Text>
      ) : (
        <Stack gap="sm">
          <FiguresCard name="Household" row={estimate} />
          {estimate.members.map((member) => (
            <FiguresCard key={member.memberId} name={memberName(member.memberId)} row={member} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
