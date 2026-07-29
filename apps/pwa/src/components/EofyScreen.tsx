import { Link } from 'react-router-dom'
import { Anchor, Card, Group, Select, Stack, Text, Title } from '@mantine/core'
import type { HelpPayoffProjection, HouseholdTaxEstimate, MemberTaxEstimate } from '@nest/tax'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate } from '../lib/dates'
import { helpPayoffSummary, type SuperCapSummary } from '../lib/tax'
import { EmptyState } from './EmptyState'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { SuperCapsSummary } from './SuperCapsSummary'
import { WithholdingPosition } from './WithholdingPosition'

interface EofyScreenProps {
  members: Member[]
  financialYear: number
  /** Financial years with a published tax config, most recent first. */
  availableFinancialYears: readonly number[]
  onFinancialYearChange: (financialYear: number) => void
  estimate: HouseholdTaxEstimate
  /** Each member's super contribution-cap status, keyed by member id. */
  capSummaries: ReadonlyMap<string, SuperCapSummary>
  helpDebts: readonly HelpDebt[]
  /** Each member's HELP/HECS payoff projection, keyed by member id (positive debts only). */
  helpPayoff: ReadonlyMap<string, HelpPayoffProjection>
  deductions: readonly DeductionRow[]
  /**
   * How many payslips each member has entered for the selected year, keyed by
   * member id; a member with none is absent. It is what tells a year with nothing
   * withheld from a year with no actuals recorded at all.
   */
  payslipCounts: ReadonlyMap<string, number>
  /** The selected FY's deductions' receipts; the caller has already filtered out any other year's. */
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
}

/** A dimmed label over its money figure, right-aligned, for a dense filing-figure list. */
function FigureLine({
  label,
  cents,
  fw,
  colored,
}: {
  label: string
  cents: number
  fw?: number
  colored?: boolean
}) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed" {...(fw !== undefined && { fw })}>
        {label}
      </Text>
      <MoneyText
        cents={cents}
        size="sm"
        {...(fw !== undefined && { fw })}
        {...(colored !== undefined && { colored })}
      />
    </Group>
  )
}

/**
 * A member's filing-relevant tax figures, condensed from the full Tax tab
 * breakdown: taxable income, tax payable, the Medicare levy and its surcharge
 * (when it applies), the HELP repayment estimate, Division 293 (when it
 * applies), total liability, and net take-home. Beneath them sits the year's
 * withholding position — the tax the member's payslips actually withheld and the
 * refund or bill it leaves — in the Tax tab's own words, with the number of slips
 * it is summed from. A member with no payslips for the year gets a note saying so
 * instead: nothing withheld and nothing recorded read the same in the figures but
 * mean opposite things at filing time.
 */
function EofyTaxSummary({
  estimate,
  financialYear,
  payslipCount,
}: {
  estimate: MemberTaxEstimate | undefined
  financialYear: number
  payslipCount: number
}) {
  if (!estimate) {
    return <EmptyState>No income to estimate yet.</EmptyState>
  }
  const { breakdown } = estimate
  const incomeTaxCents = Math.max(0, breakdown.incomeTaxCents - breakdown.litoOffsetCents)
  return (
    <Stack gap={4}>
      <FigureLine label="Taxable income" cents={breakdown.taxableIncomeCents} fw={600} />
      <FigureLine label="Income tax" cents={incomeTaxCents} />
      <FigureLine label="Medicare levy" cents={breakdown.medicareLevyCents} />
      {breakdown.medicareLevySurchargeCents > 0 && (
        <FigureLine label="Medicare levy surcharge" cents={breakdown.medicareLevySurchargeCents} />
      )}
      <FigureLine label="HELP repayment" cents={breakdown.helpRepaymentCents} />
      {breakdown.division293Cents > 0 && (
        <FigureLine label="Division 293 tax" cents={breakdown.division293Cents} />
      )}
      <FigureLine label="Total tax liability" cents={breakdown.totalLiabilityCents} fw={700} />
      <FigureLine label="Net take-home" cents={estimate.annualAfterTaxCents} fw={700} colored />
      {payslipCount === 0 ? (
        <Text size="xs" c="dimmed" fs="italic">
          No payslips recorded for FY{financialYear}, so no withholding is netted against this
          liability.
        </Text>
      ) : (
        <Stack gap={2}>
          <WithholdingPosition breakdown={breakdown} />
          <Text size="xs" c="dimmed">
            Withholding summed from {payslipCount} payslip{payslipCount === 1 ? '' : 's'}.
          </Text>
        </Stack>
      )}
    </Stack>
  )
}

/** One claimed deduction with its amount, date, and any stored receipts as view links. */
function EofyDeductionItem({
  deduction,
  receipts,
  signedUrl,
}: {
  deduction: DeductionRow
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
}) {
  const viewReceipt = async (path: string) => {
    const url = await signedUrl(path)
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  return (
    <Stack gap={2}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" truncate>
            {deduction.description}
          </Text>
          <Text size="xs" c="dimmed">
            {formatIsoDate(deduction.deduction_date)}
          </Text>
        </Stack>
        <MoneyText cents={deduction.amount_cents} size="sm" fw={600} />
      </Group>
      {receipts.length > 0 ? (
        <Group gap="xs" wrap="wrap">
          {receipts.map((receipt) => (
            <Anchor
              key={receipt.id}
              size="xs"
              component="button"
              type="button"
              onClick={() => void viewReceipt(receipt.storage_path)}
            >
              {receipt.file_name}
            </Anchor>
          ))}
        </Group>
      ) : (
        <Text size="xs" c="dimmed" fs="italic">
          No receipt
        </Text>
      )}
    </Stack>
  )
}

/** A member's claimed deductions for the year, with a running total and their receipts. */
function EofyDeductionsSummary({
  deductions,
  receipts,
  signedUrl,
}: {
  deductions: readonly DeductionRow[]
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
}) {
  if (deductions.length === 0) {
    return <EmptyState>No deductions claimed.</EmptyState>
  }
  const totalCents = deductions.reduce((total, deduction) => total + deduction.amount_cents, 0)
  return (
    <Stack gap="xs">
      <FigureLine label="Total deductions claimed" cents={totalCents} fw={600} />
      {deductions.map((deduction) => (
        <EofyDeductionItem
          key={deduction.id}
          deduction={deduction}
          receipts={receipts.filter((receipt) => receipt.deduction_id === deduction.id)}
          signedUrl={signedUrl}
        />
      ))}
    </Stack>
  )
}

/** A member's super contributions for the year: cap usage, over-cap warnings, and co-contribution. */
function EofySuperSummary({ capSummary }: { capSummary: SuperCapSummary | undefined }) {
  if (
    !capSummary ||
    (capSummary.concessionalCents === 0 && capSummary.nonConcessionalCents === 0)
  ) {
    return <EmptyState>No super contributions recorded.</EmptyState>
  }
  return <SuperCapsSummary summary={capSummary} />
}

/** A member's standing HELP/HECS balance and this year's estimated compulsory repayment. */
function EofyHelpDebtSummary({
  debt,
  financialYear,
  repaymentCents,
  payoff,
}: {
  debt: HelpDebt | undefined
  financialYear: number
  repaymentCents: number
  payoff: HelpPayoffProjection | undefined
}) {
  const balanceCents = debt?.balance_cents ?? 0
  if (balanceCents === 0) {
    return <EmptyState>No HELP/HECS debt on file.</EmptyState>
  }
  return (
    <Stack gap={4}>
      <FigureLine label="Standing HELP balance" cents={balanceCents} fw={600} />
      <FigureLine label={`Estimated FY${financialYear} repayment`} cents={repaymentCents} />
      {payoff && (
        <Text size="xs" c="dimmed">
          {helpPayoffSummary(payoff)}
        </Text>
      )}
    </Stack>
  )
}

/** A subsection heading, sized to sit within a member's card beneath their name. */
function SubsectionTitle({ children }: { children: string }) {
  return (
    <Title order={3} size="h6">
      {children}
    </Title>
  )
}

/**
 * One member's filing-prep summary for the financial year: their tax estimate
 * (net of what their payslips withheld), claimed deductions, super contributions,
 * and HELP debt, gathered from across the Tax, Payslips, Deductions, Super, and
 * HELP debt tabs.
 */
function EofyMemberCard({
  member,
  financialYear,
  memberEstimate,
  payslipCount,
  capSummary,
  helpDebt,
  helpPayoffProjection,
  deductions,
  receipts,
  signedUrl,
}: {
  member: Member
  financialYear: number
  memberEstimate: MemberTaxEstimate | undefined
  payslipCount: number
  capSummary: SuperCapSummary | undefined
  helpDebt: HelpDebt | undefined
  helpPayoffProjection: HelpPayoffProjection | undefined
  deductions: readonly DeductionRow[]
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
}) {
  return (
    <Card component="section" aria-label={member.name} withBorder radius="md" p="md">
      <Stack gap="md">
        <Text fw={700} size="lg">
          {member.name}
        </Text>

        <Stack gap="xs">
          <SubsectionTitle>Tax estimate</SubsectionTitle>
          <EofyTaxSummary
            estimate={memberEstimate}
            financialYear={financialYear}
            payslipCount={payslipCount}
          />
        </Stack>

        <Stack gap="xs">
          <SubsectionTitle>Deductions</SubsectionTitle>
          <EofyDeductionsSummary
            deductions={deductions}
            receipts={receipts}
            signedUrl={signedUrl}
          />
        </Stack>

        <Stack gap="xs">
          <SubsectionTitle>Super contributions</SubsectionTitle>
          <EofySuperSummary capSummary={capSummary} />
        </Stack>

        <Stack gap="xs">
          <SubsectionTitle>HELP debt</SubsectionTitle>
          <EofyHelpDebtSummary
            debt={helpDebt}
            financialYear={financialYear}
            repaymentCents={memberEstimate?.breakdown.helpRepaymentCents ?? 0}
            payoff={helpPayoffProjection}
          />
        </Stack>
      </Stack>
    </Card>
  )
}

/** The FY picker, offering every financial year with a published tax config. */
function FinancialYearSelect({
  financialYear,
  availableFinancialYears,
  onChange,
}: {
  financialYear: number
  availableFinancialYears: readonly number[]
  onChange: (financialYear: number) => void
}) {
  return (
    <Select
      label="Financial year"
      w={160}
      allowDeselect={false}
      data={availableFinancialYears.map((year) => ({ value: String(year), label: `FY${year}` }))}
      value={String(financialYear)}
      onChange={(value) => {
        if (value) {
          onChange(Number(value))
        }
      }}
    />
  )
}

/**
 * Presentational EOFY summary: a financial-year selector over a read-only,
 * per-member rollup of that year's tax estimate and withholding position, claimed
 * deductions, super contributions, and HELP debt — gathered from across the Tax,
 * Payslips, Deductions, Super, and HELP debt tabs into one filing-prep view.
 * Nothing here is editable; the linked tabs are where each figure is entered.
 */
export function EofyScreen({
  members,
  financialYear,
  availableFinancialYears,
  onFinancialYearChange,
  estimate,
  capSummaries,
  helpDebts,
  helpPayoff,
  deductions,
  payslipCounts,
  receipts,
  signedUrl,
}: EofyScreenProps) {
  const helpDebtByMember = new Map(helpDebts.map((debt) => [debt.member_id, debt]))

  return (
    <PageSection
      title={`EOFY summary (FY${financialYear})`}
      intro="Each member’s tax estimate — net of the tax their payslips actually withheld — plus their deductions, super contributions, and HELP debt for the selected financial year, gathered in one place for tax-return prep."
    >
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
        <FinancialYearSelect
          financialYear={financialYear}
          availableFinancialYears={availableFinancialYears}
          onChange={onFinancialYearChange}
        />
        <Group gap="md" wrap="wrap">
          <Anchor component={Link} to="/tax" size="sm">
            Tax
          </Anchor>
          <Anchor component={Link} to="/payslips" size="sm">
            Payslips
          </Anchor>
          <Anchor component={Link} to="/deductions" size="sm">
            Deductions
          </Anchor>
          <Anchor component={Link} to="/super" size="sm">
            Super
          </Anchor>
          <Anchor component={Link} to="/help-debt" size="sm">
            HELP debt
          </Anchor>
        </Group>
      </Group>

      {members.length === 0 ? (
        <EmptyState>No household members yet.</EmptyState>
      ) : (
        members.map((member) => (
          <EofyMemberCard
            key={member.id}
            member={member}
            financialYear={financialYear}
            memberEstimate={estimate.members.find((candidate) => candidate.memberId === member.id)}
            payslipCount={payslipCounts.get(member.id) ?? 0}
            capSummary={capSummaries.get(member.id)}
            helpDebt={helpDebtByMember.get(member.id)}
            helpPayoffProjection={helpPayoff.get(member.id)}
            deductions={deductions.filter((deduction) => deduction.member_id === member.id)}
            receipts={receipts}
            signedUrl={signedUrl}
          />
        ))
      )}

      <Text size="xs" c="dimmed">
        This estimate excludes capital gains tax, which is not tracked.
      </Text>
    </PageSection>
  )
}
