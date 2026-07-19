import { Card, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
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

/** The six figure cells for one row of the wide-screen table. */
function figureCells(row: Row) {
  return FIELDS.map((field) => <Table.Td key={field.key}>{formatCents(row[field.key])}</Table.Td>)
}

/** Presentational household tax estimate: per-member and household annual/fortnightly figures. */
export function TaxEstimateView({ estimate, financialYear, memberName }: TaxEstimateViewProps) {
  const wide = useMediaQuery('(min-width: 48em)')

  return (
    <Stack gap="md">
      <Title order={2}>Tax estimate (FY{financialYear})</Title>

      {estimate.annualGrossCents === 0 ? (
        <Text c="dimmed">
          No income to estimate yet. Add a taxable inflow on the Inflows tab to see a tax estimate.
        </Text>
      ) : wide ? (
        <Table.ScrollContainer minWidth={0}>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th rowSpan={2}>Member</Table.Th>
                <Table.Th colSpan={3}>Annual</Table.Th>
                <Table.Th colSpan={3}>Fortnightly</Table.Th>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Gross</Table.Th>
                <Table.Th>Tax</Table.Th>
                <Table.Th>After tax</Table.Th>
                <Table.Th>Gross</Table.Th>
                <Table.Th>Tax</Table.Th>
                <Table.Th>After tax</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {estimate.members.map((member) => (
                <Table.Tr key={member.memberId}>
                  <Table.Th scope="row">{memberName(member.memberId)}</Table.Th>
                  {figureCells(member)}
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th scope="row">Household</Table.Th>
                {figureCells(estimate)}
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Stack gap="sm">
          {estimate.members.map((member) => (
            <FiguresCard key={member.memberId} name={memberName(member.memberId)} row={member} />
          ))}
          <FiguresCard name="Household" row={estimate} />
        </Stack>
      )}
    </Stack>
  )
}
