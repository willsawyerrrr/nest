import { useMemo } from 'react'
import { Group, SimpleGrid, Stack, Text } from '@mantine/core'
import type { PayslipVariance, PayslipYearPosition } from '@nest/plan'
import type { HouseholdTaxEstimate, TaxYearConfig } from '@nest/tax'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { PayslipLineRow } from '../hooks/usePayslipLines'
import type { PayslipAttachments, PayslipRow, PayslipSubmission } from '../hooks/usePayslips'
import {
  payslipReconciliation,
  payslipTotalsFromRows,
  payslipVariancesById,
  payslipYearPositionsFromRows,
  periodLabel,
  reportedYearToDateFromRows,
  type PayslipReconciliation,
} from '../lib/payslips'
import { EditableList } from './EditableList'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { FigureCell, PayslipCard } from './PayslipCard'
import { PayslipForm } from './PayslipForm'

interface PayslipsScreenProps {
  members: Member[]
  payslips: PayslipRow[]
  /** Every payslip line the household has; each slip picks out its own. */
  lines: PayslipLineRow[]
  inflows: Inflow[]
  financialYear: number
  /** The household tax estimate the withholding and super expectations are read from. */
  estimate: HouseholdTaxEstimate
  /** The tax + super config for the financial year, supplying the super guarantee rate. */
  config: TaxYearConfig
  /** Storing, discarding, and reading the document a form attaches. */
  attachments: PayslipAttachments
  onCreate: (submission: PayslipSubmission) => Promise<void>
  onUpdate: (id: string, submission: PayslipSubmission) => Promise<void>
  onDelete: (id: string) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}

/**
 * The gap between the year-to-date gross printed on a member's latest payslip and
 * the gross summed from the slips entered — a gap means slips from earlier in the
 * year were never entered. Nothing is shown when the two agree.
 */
function ReportedYearToDateNote({
  reportedGrossCents,
  summedGrossCents,
}: {
  reportedGrossCents: number
  summedGrossCents: number
}) {
  const gapCents = reportedGrossCents - summedGrossCents
  if (gapCents === 0) {
    return null
  }
  return (
    <Text size="xs" c="dimmed">
      The latest slip reports <MoneyText span cents={reportedGrossCents} /> gross year to date,{' '}
      <MoneyText span cents={Math.abs(gapCents)} /> {gapCents > 0 ? 'more than' : 'less than'} the
      slips entered here.
    </Text>
  )
}

/**
 * How much of the year a position speaks for, where it speaks for less than the
 * figure it sits under: the slips whose expectation is known, of every slip summed
 * into that figure. It reads on from the variance above it — "$450.00 above plan,
 * across 3 of 4 slips" — so the two lines are one sentence.
 *
 * Null where every slip is covered, there being nothing to qualify, and null where
 * none is: the variance above already says there is no projection to compare, and
 * "across 0 of 4 slips" would only dress that up as a shortfall.
 */
function coverageNote({ coveredCount, payslipCount }: PayslipYearPosition): string | null {
  if (coveredCount === 0 || coveredCount === payslipCount) {
    return null
  }
  return `Across ${coveredCount} of ${payslipCount} slips`
}

/**
 * A member's year-to-date actuals summed from the payslips entered, each held
 * against the plan, with the running totals printed on their latest slip as a
 * cross-check.
 *
 * The three figures carry three positions rather than one headline because they
 * answer three questions — whether the pay came through, whether the withholding
 * tracks the liability, whether the super is being paid — and a year that is on
 * plan for gross and short on super is exactly the case worth seeing. The grid
 * reflows from two columns on a phone to three from the `xs` breakpoint up, the way
 * a card's quartet does: a figure plus a variance plus a coverage note needs more
 * than a third of a phone's width to read.
 *
 * Super is the whole concessional total — employer super plus salary sacrifice —
 * because that is the figure a card shows and the figure the expectation is built
 * to match, so the year and the slips under it name the same thing.
 */
function MemberTotals({
  payslips,
  variances,
}: {
  payslips: readonly PayslipRow[]
  variances: ReadonlyMap<string, PayslipVariance>
}) {
  const totals = payslipTotalsFromRows(payslips)
  const reported = reportedYearToDateFromRows(payslips)
  const positions = payslipYearPositionsFromRows(payslips, variances)

  return (
    <Stack gap={2}>
      <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="xs">
        <FigureCell
          label="YTD gross"
          cents={totals.grossCents}
          varianceCents={positions.gross.varianceCents}
          note={coverageNote(positions.gross)}
        />
        <FigureCell
          label="YTD withheld"
          cents={totals.taxWithheldCents}
          varianceCents={positions.taxWithheld.varianceCents}
          note={coverageNote(positions.taxWithheld)}
        />
        <FigureCell
          label="YTD super"
          cents={totals.superCents + totals.salarySacrificeCents}
          varianceCents={positions.super.varianceCents}
          note={coverageNote(positions.super)}
        />
      </SimpleGrid>
      {reported !== null && (
        <ReportedYearToDateNote
          reportedGrossCents={reported.grossCents}
          summedGrossCents={totals.grossCents}
        />
      )}
    </Stack>
  )
}

/** A member's payslips, most recent first, with their year-to-date actuals and an add form. */
function MemberPayslips({
  member,
  payslips,
  reconciliation,
  inflows,
  estimate,
  config,
  attachments,
  onCreate,
  onUpdate,
  onDelete,
  signedUrl,
}: {
  member: Member
  payslips: PayslipRow[]
  reconciliation: PayslipReconciliation
  inflows: Inflow[]
  estimate: HouseholdTaxEstimate
  config: TaxYearConfig
  attachments: PayslipAttachments
  onCreate: (submission: PayslipSubmission) => Promise<void>
  onUpdate: (id: string, submission: PayslipSubmission) => Promise<void>
  onDelete: (id: string) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}) {
  const memberEstimate = estimate.members.find((each) => each.memberId === member.id)
  // Measured once for the member: each card reads its own slip's measurement out
  // of this, and the year-to-date position sums the very same ones.
  const variances = payslipVariancesById(payslips, reconciliation, memberEstimate, config)

  const viewDocument = async (path: string) => {
    const url = await signedUrl(path)
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600}>{member.name}</Text>
        <Text size="sm" c="dimmed">
          {payslips.length === 1 ? '1 payslip' : `${payslips.length} payslips`}
        </Text>
      </Group>

      {payslips.length > 0 && <MemberTotals payslips={payslips} variances={variances} />}

      <EditableList<PayslipRow, PayslipSubmission>
        items={payslips}
        addLabel="Add payslip"
        emptyMessage="No payslips yet."
        deleteTarget={(payslip) => ({
          title: 'Delete payslip?',
          itemLabel: periodLabel(payslip),
        })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(payslip, { onEdit, onDelete: onDeleteItem }) => (
          <PayslipCard
            payslip={payslip}
            variance={variances.get(payslip.id)!}
            inflowNames={reconciliation.inflowNames}
            onEdit={onEdit}
            onDelete={onDeleteItem}
            onViewDocument={(path) => void viewDocument(path)}
          />
        )}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <PayslipForm
            member={member}
            inflows={inflows}
            initialLines={
              initial === undefined ? [] : (reconciliation.linesByPayslip.get(initial.id) ?? [])
            }
            attachments={attachments}
            initial={initial}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      />
    </Stack>
  )
}

/**
 * Presentational payslips manager: one list per household member, most recent pay
 * period first, each slip's actual gross / withheld / super / net measured against
 * what the plan projected for that period, under the member's year to date measured
 * the same way — the slips' own expectations summed. Persistence lives in the caller.
 */
export function PayslipsScreen({
  members,
  payslips,
  lines,
  inflows,
  financialYear,
  estimate,
  config,
  attachments,
  onCreate,
  onUpdate,
  onDelete,
  signedUrl,
}: PayslipsScreenProps) {
  // Household-wide and read by every card, so built once for the whole screen
  // rather than per member and per slip.
  const reconciliation = useMemo(() => payslipReconciliation(inflows, lines), [inflows, lines])

  return (
    <PageSection
      title={`Payslips (FY${financialYear})`}
      intro="What each pay event actually paid, measured line by line against the projected inflows and the tax estimate. Withholding entered here is what turns the Tax tab’s estimated liability into a refund or a bill; withholding more than the plan expects points to a refund, not a problem."
    >
      {members.map((member) => (
        <MemberPayslips
          key={member.id}
          member={member}
          payslips={payslips.filter((payslip) => payslip.member_id === member.id)}
          reconciliation={reconciliation}
          inflows={inflows}
          estimate={estimate}
          config={config}
          attachments={attachments}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          signedUrl={signedUrl}
        />
      ))}
    </PageSection>
  )
}
