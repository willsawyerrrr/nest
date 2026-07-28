import { Anchor, Badge, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import type { PayslipVariance } from '@nest/plan'
import type { HouseholdTaxEstimate, TaxYearConfig } from '@nest/tax'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { PayslipAttachments, PayslipRow, PayslipSubmission } from '../hooks/usePayslips'
import { formatIsoDate } from '../lib/dates'
import { moneyColor } from '../lib/money'
import {
  payslipTotalsFromRows,
  payslipVarianceFor,
  reportedYearToDateFromRows,
} from '../lib/payslips'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { PayslipForm } from './PayslipForm'

interface PayslipsScreenProps {
  members: Member[]
  payslips: PayslipRow[]
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

/** The inclusive pay period as a short date range. */
function periodLabel(payslip: PayslipRow): string {
  return `${formatIsoDate(payslip.period_start)} – ${formatIsoDate(payslip.period_end)}`
}

/**
 * A figure's variance against the plan: its size in the app's sign colouring with
 * the direction spelled out, so a tint is never read alone. `null` means the
 * payslip reconciles against no inflow, which is stated rather than shown as a
 * zero or a bare dash.
 *
 * Colour follows the money sign of the variance itself: above plan reads
 * positive, below plan negative. That is the right reading for withholding too —
 * more tax withheld than the estimate implies is a larger refund at year end,
 * not a problem, while withholding less than the liability is what leaves a bill
 * to pay.
 */
function VarianceNote({ varianceCents }: { varianceCents: number | null }) {
  if (varianceCents === null) {
    return (
      <Text size="xs" c="dimmed">
        No projection to compare
      </Text>
    )
  }
  if (varianceCents === 0) {
    return (
      <Text size="xs" c="dimmed">
        On plan
      </Text>
    )
  }
  const color = moneyColor(varianceCents)
  return (
    <Text size="xs" {...(color !== undefined && { c: color })}>
      <MoneyText span cents={Math.abs(varianceCents)} />
      {varianceCents > 0 ? ' above plan' : ' below plan'}
    </Text>
  )
}

/** One of a payslip's figures: its label, the amount, and any variance beneath. */
function FigureCell({
  label,
  cents,
  varianceCents,
}: {
  label: string
  cents: number
  varianceCents?: number | null
}) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <MoneyText cents={cents} fw={600} size="sm" />
      {varianceCents !== undefined && <VarianceNote varianceCents={varianceCents} />}
    </Stack>
  )
}

/** A link opening a payslip's stored document, which is fetched through a signed URL. */
function DocumentLink({ path, onView }: { path: string; onView: (path: string) => void }) {
  return (
    <Anchor
      size="xs"
      component="button"
      type="button"
      onClick={() => onView(path)}
      style={{ alignSelf: 'flex-start' }}
    >
      View payslip document
    </Anchor>
  )
}

interface PayslipCardProps {
  payslip: PayslipRow
  variance: PayslipVariance
  /** The reconciled inflow's name, or undefined when the slip maps to none. */
  inflowName: string | undefined
  onEdit: () => void
  onDelete: () => void
  onViewDocument: (path: string) => void
}

/**
 * One payslip: its pay period and the inflow it reconciles against, the gross /
 * withheld / super / net quartet each with its variance against the plan, and its
 * note and stored document. The figure grid reflows from two columns on a phone to
 * four from the `xs` breakpoint up — a payslip carries four figures and three
 * variances, more than a single dense row can hold. A period that is not one whole
 * turn of the inflow's cadence says so, since its expectations are apportioned by
 * calendar days and carry a proration remainder an on-cadence period does not.
 */
function PayslipCard({
  payslip,
  variance,
  inflowName,
  onEdit,
  onDelete,
  onViewDocument,
}: PayslipCardProps) {
  return (
    <AppCard withBorder padding="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600} size="sm">
              {periodLabel(payslip)}
            </Text>
            <Group gap="xxs" wrap="wrap">
              {payslip.paid_on !== null && (
                <Text size="xs" c="dimmed">
                  Paid {formatIsoDate(payslip.paid_on)}
                </Text>
              )}
              {inflowName !== undefined && (
                <Badge size="xs" color="gray">
                  {inflowName}
                </Badge>
              )}
            </Group>
          </Stack>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs">
          <FigureCell
            label="Gross"
            cents={payslip.gross_cents}
            varianceCents={variance.grossVarianceCents}
          />
          <FigureCell
            label="Tax withheld"
            cents={payslip.tax_withheld_cents}
            varianceCents={variance.taxWithheldVarianceCents}
          />
          <FigureCell
            label="Super"
            cents={variance.actualSuperCents}
            varianceCents={variance.superVarianceCents}
          />
          <FigureCell label="Net" cents={payslip.net_cents} />
        </SimpleGrid>

        {inflowName !== undefined && variance.basis === 'calendar_days' && (
          <Text size="xs" c="dimmed">
            This period is not one whole turn of the inflow’s pay cycle, so the plan figures are
            apportioned by calendar days — a small variance is the proration itself.
          </Text>
        )}

        {payslip.note !== null && (
          <Text size="xs" c="dimmed">
            {payslip.note}
          </Text>
        )}

        {payslip.file_path !== null && (
          <DocumentLink path={payslip.file_path} onView={onViewDocument} />
        )}
      </Stack>
    </AppCard>
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
 * A member's year-to-date actuals summed from the payslips entered, with the
 * running totals printed on their latest slip as a cross-check.
 */
function MemberTotals({ payslips }: { payslips: readonly PayslipRow[] }) {
  const totals = payslipTotalsFromRows(payslips)
  const reported = reportedYearToDateFromRows(payslips)

  return (
    <Stack gap={2}>
      <SimpleGrid cols={3} spacing="xs">
        <FigureCell label="YTD gross" cents={totals.grossCents} />
        <FigureCell label="YTD withheld" cents={totals.taxWithheldCents} />
        <FigureCell label="YTD super" cents={totals.superCents} />
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

      {payslips.length > 0 && <MemberTotals payslips={payslips} />}

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
        renderItem={(payslip, { onEdit, onDelete: onDeleteItem }) => {
          const inflow = inflows.find((each) => each.id === payslip.source_inflow_id)
          return (
            <PayslipCard
              payslip={payslip}
              variance={payslipVarianceFor(payslip, inflow, memberEstimate, config)}
              inflowName={inflow?.name}
              onEdit={onEdit}
              onDelete={onDeleteItem}
              onViewDocument={(path) => void viewDocument(path)}
            />
          )
        }}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <PayslipForm
            member={member}
            inflows={inflows}
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
 * what the plan projected for that period. Persistence lives in the caller.
 */
export function PayslipsScreen({
  members,
  payslips,
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
  return (
    <PageSection
      title={`Payslips (FY${financialYear})`}
      intro="What each pay event actually paid, measured against the projected inflow and the tax estimate. Withholding entered here is what turns the Tax tab’s estimated liability into a refund or a bill; withholding more than the plan expects points to a refund, not a problem."
    >
      {members.map((member) => (
        <MemberPayslips
          key={member.id}
          member={member}
          payslips={payslips.filter((payslip) => payslip.member_id === member.id)}
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
