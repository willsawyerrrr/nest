import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, Card, Group, Stack, Text, Title } from '@mantine/core'
import {
  configsByYear,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type MemberTaxEstimate,
} from '@nest/tax'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate } from '../lib/dates'
import { groupDeductions } from '../lib/deductionGroups'
import { formatCents, formatCentsRate } from '../lib/money'
import { helpPayoffSummary, type SuperCapSummary } from '../lib/tax'
import { EmptyState } from './EmptyState'
import { FinancialYearSelect } from './FinancialYearSelect'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { SuperCapsSummary } from './SuperCapsSummary'
import { WithholdingPosition } from './WithholdingPosition'

/**
 * A payslip document to list against its member: the printed date the pay
 * landed (or null, for a slip carrying none) and the object path
 * `payslipSignedUrl` resolves for viewing. Deliberately narrower than
 * `Tables<'payslip'>` — a document link is all this section shows.
 */
export interface EofyPayslipDocument {
  id: string
  memberId: string
  paidOn: string | null
  filePath: string
}

interface EofyScreenProps {
  /** `{ id, name }` is all this screen shows; a narrower type than `Member` so a shared payload carrying only those two type-checks without a parallel prop. */
  members: readonly Pick<Member, 'id' | 'name'>[]
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
  /** The selected FY's deduction groups, in display order; each member's own are listed under their name. */
  deductionGroups: readonly DeductionGroupRow[]
  /**
   * How many payslips each member has entered for the selected year, keyed by
   * member id; a member with none is absent. It is what tells a year with nothing
   * withheld from a year with no actuals recorded at all.
   */
  payslipCounts: ReadonlyMap<string, number>
  /** The selected FY's deductions' receipts; the caller has already filtered out any other year's. */
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
  /**
   * Hides the Tax/Payslips/Deductions/Super/HELP debt anchor links, which point
   * at authenticated routes a viewer without a session (the shared EOFY view)
   * has no access to. Defaults to true, so the authenticated route is unaffected.
   */
  showTabLinks?: boolean
  /** A second dimmed note alongside the "excludes capital gains tax" line; omitted where the caller has none. */
  disclaimerNote?: string
  /**
   * The selected year's payslip attachments, for a "Payslip documents"
   * subsection per member. Rendered only when this and `payslipSignedUrl` are
   * both supplied.
   */
  payslipDocuments?: readonly EofyPayslipDocument[]
  payslipSignedUrl?: (path: string) => Promise<string | null>
  /** Household-level content shown under the year selector, ahead of the member cards; omitted where the caller has none. */
  householdSection?: ReactNode
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
      {estimate.annualNetCapitalGainCents > 0 && (
        <FigureLine label="Net capital gain" cents={estimate.annualNetCapitalGainCents} />
      )}
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

/**
 * How a deduction's claim was worked out, for a tax agent checking it: the
 * kilometres or hours (at the financial year's published rate, when there is
 * one) on the distance or hours basis, or the full cost and work use percentage
 * when claimed at less than 100%. Null for a deduction claimed in full.
 */
function claimWorkings(deduction: DeductionRow): string | null {
  if (deduction.basis === 'distance' && deduction.distance_km !== null) {
    const rate = configsByYear[deduction.financial_year]?.carExpense.centsPerKm
    const km = `${deduction.distance_km.toLocaleString()} km`
    return rate === undefined ? km : `${km} at ${formatCentsRate(rate, 'km')}`
  }
  if (deduction.basis === 'hours' && deduction.work_from_home_hours !== null) {
    const rate = configsByYear[deduction.financial_year]?.workFromHome.centsPerHour
    const hours = `${deduction.work_from_home_hours.toLocaleString()} hours`
    return rate === undefined ? hours : `${hours} at ${formatCentsRate(rate, 'hr')}`
  }
  if (deduction.work_use_percent < 100) {
    return `${formatCents(deduction.full_amount_cents)} at ${deduction.work_use_percent}%`
  }
  return null
}

/** One claimed deduction on a single row: description, date, and receipt link wrapping beside a right-aligned amount with its workings beneath. */
function EofyDeductionItem({
  deduction,
  receipt,
  signedUrl,
}: {
  deduction: DeductionRow
  receipt: DeductionReceiptRow | undefined
  signedUrl: (path: string) => Promise<string | null>
}) {
  const viewReceipt = async (path: string) => {
    const url = await signedUrl(path)
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  const workings = claimWorkings(deduction)

  return (
    <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
      <Group gap="xs" style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm">{deduction.description}</Text>
        <Text size="xs" c="dimmed">
          {formatIsoDate(deduction.deduction_date)}
        </Text>
        {deduction.basis === 'hours' ? null : receipt ? (
          <Anchor
            size="xs"
            component="button"
            type="button"
            onClick={() => void viewReceipt(receipt.storage_path)}
          >
            Receipt
          </Anchor>
        ) : (
          <Text size="xs" c="dimmed" fs="italic">
            No receipt
          </Text>
        )}
      </Group>
      <Stack gap={0} align="flex-end">
        <MoneyText cents={deduction.amount_cents} size="sm" fw={600} />
        {workings && (
          <Text size="xs" c="dimmed" ta="right">
            {workings}
          </Text>
        )}
      </Stack>
    </Group>
  )
}

/**
 * A member's claimed deductions for the year, with a running total and their
 * receipts. Each group (the automatic donations group included) is a heading
 * with its payments beneath and their summed total; deductions in no group follow
 * as top-level rows beside the group headings.
 */
function EofyDeductionsSummary({
  deductions,
  groups,
  receipts,
  signedUrl,
}: {
  deductions: readonly DeductionRow[]
  groups: readonly DeductionGroupRow[]
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
}) {
  if (deductions.length === 0 && groups.length === 0) {
    return <EmptyState>No deductions claimed.</EmptyState>
  }
  const totalCents = deductions.reduce((total, deduction) => total + deduction.amount_cents, 0)
  const grouped = groupDeductions(groups, deductions)
  const renderItems = (items: readonly DeductionRow[]) =>
    items.map((deduction) => (
      <EofyDeductionItem
        key={deduction.id}
        deduction={deduction}
        receipt={receipts.find((receipt) => receipt.deduction_id === deduction.id)}
        signedUrl={signedUrl}
      />
    ))
  return (
    <Stack gap="xs">
      <FigureLine label="Total deductions claimed" cents={totalCents} fw={600} />
      {grouped.groups.map(({ group, payments, totalCents: groupCents }) => (
        <Stack key={group.id} gap={4} aria-label={group.name} component="section">
          <FigureLine label={group.name} cents={groupCents} fw={600} />
          {payments.length === 0 ? (
            <Text size="xs" c="dimmed" fs="italic">
              No payments
            </Text>
          ) : (
            <Stack gap="xs" pl="sm">
              {renderItems(payments)}
            </Stack>
          )}
        </Stack>
      ))}
      {renderItems(grouped.ungrouped)}
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

/** A member's attached payslip documents for the year, each opening a signed URL on click. */
function EofyPayslipDocumentsSummary({
  documents,
  signedUrl,
}: {
  documents: readonly EofyPayslipDocument[]
  signedUrl: (path: string) => Promise<string | null>
}) {
  if (documents.length === 0) {
    return <EmptyState>No payslip documents attached.</EmptyState>
  }
  const openDocument = async (path: string) => {
    const url = await signedUrl(path)
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }
  return (
    <Group gap="xs" wrap="wrap">
      {documents.map((document) => (
        <Anchor
          key={document.id}
          size="xs"
          component="button"
          type="button"
          onClick={() => void openDocument(document.filePath)}
        >
          {document.paidOn ? formatIsoDate(document.paidOn) : 'Payslip'}
        </Anchor>
      ))}
    </Group>
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
  deductionGroups,
  receipts,
  signedUrl,
  payslipDocuments,
  payslipSignedUrl,
}: {
  member: Pick<Member, 'id' | 'name'>
  financialYear: number
  memberEstimate: MemberTaxEstimate | undefined
  payslipCount: number
  capSummary: SuperCapSummary | undefined
  helpDebt: HelpDebt | undefined
  helpPayoffProjection: HelpPayoffProjection | undefined
  deductions: readonly DeductionRow[]
  deductionGroups: readonly DeductionGroupRow[]
  receipts: readonly DeductionReceiptRow[]
  signedUrl: (path: string) => Promise<string | null>
  /** This member's payslip documents; omitted (with `payslipSignedUrl`) when the section is off. */
  payslipDocuments?: readonly EofyPayslipDocument[]
  payslipSignedUrl?: (path: string) => Promise<string | null>
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
            groups={deductionGroups}
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

        {payslipDocuments && payslipSignedUrl && (
          <Stack gap="xs">
            <SubsectionTitle>Payslip documents</SubsectionTitle>
            <EofyPayslipDocumentsSummary
              documents={payslipDocuments}
              signedUrl={payslipSignedUrl}
            />
          </Stack>
        )}
      </Stack>
    </Card>
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
  deductionGroups,
  payslipCounts,
  receipts,
  signedUrl,
  showTabLinks = true,
  disclaimerNote,
  payslipDocuments,
  payslipSignedUrl,
  householdSection,
}: EofyScreenProps) {
  const helpDebtByMember = new Map(helpDebts.map((debt) => [debt.member_id, debt]))
  const showPayslipDocuments = payslipDocuments !== undefined && payslipSignedUrl !== undefined

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
        {showTabLinks && (
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
        )}
      </Group>

      {householdSection}

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
            deductionGroups={deductionGroups.filter((group) => group.member_id === member.id)}
            receipts={receipts}
            signedUrl={signedUrl}
            {...(showPayslipDocuments && {
              payslipDocuments: payslipDocuments.filter(
                (document) => document.memberId === member.id,
              ),
              payslipSignedUrl,
            })}
          />
        ))
      )}

      <Text size="xs" c="dimmed">
        Capital gains are counted only for the share and ETF trades recorded on the Investments tab.
      </Text>
      {disclaimerNote && (
        <Text size="xs" c="dimmed">
          {disclaimerNote}
        </Text>
      )}
    </PageSection>
  )
}
