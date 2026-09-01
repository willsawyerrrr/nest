import { useMemo, useState } from 'react'
import { Alert, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core'
import type { PayslipVariance, PayslipYearPosition, UnmeasuredInflowPosition } from '@nest/plan'
import type { HouseholdTaxEstimate, TaxYearConfig } from '@nest/tax'
import type { DocumentIntakeRow } from '../hooks/useDocumentIntake'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { PayslipLineRow } from '../hooks/usePayslipLines'
import type { PayslipAttachments, PayslipRow, PayslipSubmission } from '../hooks/usePayslips'
import { formatIsoDate } from '../lib/dates'
import {
  payslipReconciliation,
  payslipTotalsFromRows,
  payslipVariancesById,
  payslipYearPositionsFromRows,
  periodLabel,
  reportedYearToDateFromRows,
  unmeasuredPositionsFor,
  type PayslipReconciliation,
} from '../lib/payslips'
import { DocumentIntakeInbox } from './DocumentIntakeInbox'
import { EditableList } from './EditableList'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { FigureCell, PayslipCard, VarianceNote } from './PayslipCard'
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
  /** Files staged by document-intake, awaiting review; every kind, filtered here to `'payslip'`. */
  documentIntake: {
    items: readonly DocumentIntakeRow[]
    download: (item: DocumentIntakeRow) => Promise<File>
    clear: (item: DocumentIntakeRow) => Promise<void>
  }
}

/**
 * The intake inbox and its review flow: downloading a staged file and opening
 * it in the ordinary add-payslip form, exactly as picking it by hand would.
 * `PayslipForm`'s own upload copies the file into the `payslips` bucket under
 * the new slip's id, so the staged copy is redundant the moment a review is
 * saved — `documentIntake.clear` drops it then, or immediately on Dismiss
 * without ever opening the form. Cancelling the review modal leaves the
 * staged item exactly as it was, for another look later.
 */
function PayslipIntakeInbox({
  members,
  inflows,
  attachments,
  documentIntake,
  onCreate,
}: {
  members: Member[]
  inflows: Inflow[]
  attachments: PayslipAttachments
  documentIntake: PayslipsScreenProps['documentIntake']
  onCreate: (submission: PayslipSubmission) => Promise<void>
}) {
  const items = documentIntake.items.filter((item) => item.kind === 'payslip')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{ item: DocumentIntakeRow; file: File } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const memberName = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? 'Unknown member'
  const reviewingMember = reviewing
    ? members.find((member) => member.id === reviewing.item.member_id)
    : undefined

  const review = async (item: DocumentIntakeRow) => {
    setError(null)
    setBusyId(item.id)
    try {
      const file = await documentIntake.download(item)
      setReviewing({ item, file })
    } catch {
      setError('Could not download this document. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  const dismiss = async (item: DocumentIntakeRow) => {
    setError(null)
    setBusyId(item.id)
    try {
      await documentIntake.clear(item)
    } catch {
      setError('Could not dismiss this document. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <DocumentIntakeInbox
        items={items}
        memberName={memberName}
        busyId={busyId}
        onReview={(item) => void review(item)}
        onDismiss={(item) => void dismiss(item)}
      />
      {error && (
        <Alert color="warning" variant="light" p="xs">
          <Text size="xs">{error}</Text>
        </Alert>
      )}
      <Modal
        opened={reviewing !== null}
        onClose={() => setReviewing(null)}
        title="Review payslip"
        size="lg"
      >
        {reviewing && reviewingMember && (
          <PayslipForm
            member={reviewingMember}
            inflows={inflows}
            attachments={attachments}
            initialFile={reviewing.file}
            onSubmit={async (submission) => {
              await onCreate(submission)
              await documentIntake.clear(reviewing.item)
              setReviewing(null)
            }}
            onCancel={() => setReviewing(null)}
          />
        )}
      </Modal>
    </>
  )
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
 * none is: the variance above already says why the figure is not measured, and
 * "across 0 of 4 slips" would only dress that up as a shortfall.
 */
function coverageNote({ coveredCount, payslipCount }: PayslipYearPosition): string | null {
  if (coveredCount === 0 || coveredCount === payslipCount) {
    return null
  }
  return `Across ${coveredCount} of ${payslipCount} slips`
}

/**
 * Each inflow no pay period measures — one whose money lands in only some periods,
 * and a one-off, whose money lands on a day of its own — measured across the year
 * instead: what the slips have paid against it, and how that stands against what the
 * plan expects by the date their latest pay reaches.
 *
 * This is where "am I getting the on-call I projected?" and "has the redundancy come
 * through?" are answered, and both are readings that belong to the year — one figure
 * per inflow, shown once above the list rather than repeated on all 26 cards, where
 * they would read as exactly the per-period comparison the whole point is that they
 * are not.
 */
function UnmeasuredPositions({
  positions,
  inflowNames,
}: {
  positions: readonly UnmeasuredInflowPosition[]
  inflowNames: ReadonlyMap<string, string>
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        Pay measured across the year
      </Text>
      {positions.map((position) => (
        <Group key={position.sourceInflowId} justify="space-between" wrap="nowrap" gap="xs">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="xs" fw={500}>
              {inflowNames.get(position.sourceInflowId)}
            </Text>
            <Text size="xs" c="dimmed">
              <MoneyText span cents={position.expectedCents} /> projected to{' '}
              {formatIsoDate(position.asAt)},{' '}
              <MoneyText span cents={position.annualExpectedCents} /> for the year
            </Text>
          </Stack>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <MoneyText cents={position.actualCents} size="xs" fw={600} />
            <VarianceNote varianceCents={position.varianceCents} />
          </Group>
        </Group>
      ))}
    </Stack>
  )
}

/**
 * A member's year-to-date actuals summed from the payslips entered, each held
 * against the plan, with the running totals printed on their latest slip as a
 * cross-check and the year's position on any pay no period measures.
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
 *
 * Both readings are drawn from `variances`, the one measurement per slip the cards
 * render, so neither the grid nor the year block can drift from a card. Pay no
 * period measures is where they meet: such a slip carries no gross expectation, so
 * it is left out of the gross position and the coverage note says so — and where
 * every slip carries it, the gross position has nothing at all to compare, which the
 * cell blames on that pay rather than on a missing projection, pointing at the block
 * below where it really is measured.
 *
 * That block sits under the reported-year-to-date cross-check rather than between it
 * and the grid: the cross-check is a footnote to the gross figure immediately above
 * it, while the block is a section of its own with a row per inflow.
 */
function MemberTotals({
  payslips,
  variances,
  reconciliation,
  financialYear,
}: {
  payslips: readonly PayslipRow[]
  variances: ReadonlyMap<string, PayslipVariance>
  reconciliation: PayslipReconciliation
  financialYear: number
}) {
  const totals = payslipTotalsFromRows(payslips)
  const reported = reportedYearToDateFromRows(payslips)
  const positions = payslipYearPositionsFromRows(payslips, variances)
  const unmeasured = unmeasuredPositionsFor(payslips, variances, reconciliation, financialYear)

  return (
    <Stack gap={2}>
      <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="xs">
        <FigureCell
          label="YTD gross"
          cents={totals.grossCents}
          varianceCents={positions.gross.varianceCents}
          note={coverageNote(positions.gross)}
          {...(unmeasured.length > 0 && {
            nullNote: 'This pay is measured across the year, below',
          })}
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
      {unmeasured.length > 0 && (
        <UnmeasuredPositions positions={unmeasured} inflowNames={reconciliation.inflowNames} />
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
  financialYear,
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
  financialYear: number
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
  // of this, and both year-to-date readings sum the very same ones.
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

      {payslips.length > 0 && (
        <MemberTotals
          payslips={payslips}
          variances={variances}
          reconciliation={reconciliation}
          financialYear={financialYear}
        />
      )}

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
 * the same way — the slips' own expectations summed, plus the year's position on any
 * pay no period measures. Persistence lives in the caller.
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
  documentIntake,
}: PayslipsScreenProps) {
  // Household-wide and read by every card, so built once for the whole screen
  // rather than per member and per slip.
  const reconciliation = useMemo(() => payslipReconciliation(inflows, lines), [inflows, lines])

  return (
    <PageSection
      title={`Payslips (FY${financialYear})`}
      intro="What each pay event actually paid, measured line by line against the projected inflows and the tax estimate. Withholding entered here is what turns the Tax tab’s estimated liability into a refund or a bill; withholding more than the plan expects points to a refund, not a problem."
    >
      <PayslipIntakeInbox
        members={members}
        inflows={inflows}
        attachments={attachments}
        documentIntake={documentIntake}
        onCreate={onCreate}
      />

      {members.map((member) => (
        <MemberPayslips
          key={member.id}
          member={member}
          payslips={payslips.filter((payslip) => payslip.member_id === member.id)}
          reconciliation={reconciliation}
          inflows={inflows}
          financialYear={financialYear}
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
