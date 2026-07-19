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

/** Fortnights per financial year, for splitting an annual concessional figure. */
const FORTNIGHTS_PER_YEAR = 26

/**
 * One row's annual and fortnightly gross/tax/after-tax figures as a compact
 * table. When `concessionalCents` is positive, its annual and fortnightly split
 * is noted below with a reminder that gross is reduced before tax; a positive
 * `division293Cents` adds the extra high-income super tax on the same note.
 */
function FiguresCard({
  name,
  row,
  concessionalCents = 0,
  division293Cents = 0,
}: {
  name: string
  row: Row
  concessionalCents?: number
  division293Cents?: number
}) {
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
        {concessionalCents > 0 && (
          <Text size="xs" c="dimmed">
            Concessional super: {formatCents(concessionalCents)}/yr ·{' '}
            {formatCents(Math.round(concessionalCents / FORTNIGHTS_PER_YEAR))}/fortnight — deducted
            from gross, so taxable income and after-tax cash are shown after super.
          </Text>
        )}
        {division293Cents > 0 && (
          <Text size="xs" c="dimmed">
            Division 293 tax: {formatCents(division293Cents)} (included in tax above)
          </Text>
        )}
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
            <FiguresCard
              key={member.memberId}
              name={memberName(member.memberId)}
              row={member}
              concessionalCents={member.annualConcessionalContributionsCents}
              division293Cents={member.breakdown.division293Cents}
            />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
