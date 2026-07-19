import { Card, Stack, Table, Text, Title } from '@mantine/core'
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

/** One row's annual and fortnightly gross/tax/after-tax figures as a compact table. */
function FiguresCard({ name, row }: { name: string; row: Row }) {
  return (
    <Card component="section" aria-label={name} withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Text fw={600}>{name}</Text>
        <Table.ScrollContainer minWidth={0}>
          <Table fz="sm" verticalSpacing={4} horizontalSpacing="xs">
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
