import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  FileInput,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconTrash } from '@tabler/icons-react'
import { carExpenseDeductionCents, configsByYear } from '@nest/tax'
import {
  useDeductionAttachment,
  type DeductionAttachments,
  type ExtractionState,
} from '../hooks/useDeductionAttachment'
import { useDeductionFields } from '../hooks/useDeductionFields'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents, formatCents, workUseAmountCents } from '../lib/money'
import { DEFAULT_RECEIPT_NAME, receiptName } from '../lib/receiptName'
import { currentTaxConfig } from '../lib/tax'
import { EnumSegmentedControl } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface DeductionFormProps {
  member: { id: string; name: string }
  /** Storing, discarding, and reading receipts picked before the deduction exists. */
  attachments: DeductionAttachments
  /** The financial year the deduction is claimed in, deciding which year's cents-per-km rate applies. */
  financialYear: number
  /**
   * The group this deduction is filed under, when the form was opened from one.
   * Omitted, an edit keeps whatever group the deduction already sits in and a
   * new deduction stands on its own.
   */
  groupId?: string | undefined
  /**
   * The member's groups for this financial year, offered as a picker so a
   * deduction can be filed under one — or taken out of one — after the fact.
   * Empty, or when the form was opened from a group, no picker is shown.
   */
  groups?: DeductionGroupRow[]
  initial?: DeductionRow | undefined
  onSubmit: (submission: DeductionSubmission) => void | Promise<void>
  onCancel?: () => void
}

type Basis = DeductionRow['basis']

/**
 * The group picker's "no group" option. A Select's value is a
 * string, and null is what the column holds, so standing on its own needs an
 * option of its own — leaving it to the placeholder would make clearing the
 * picker the only way back out, which nothing on screen says is possible. No
 * group id can collide: they are uuids.
 */
const NO_GROUP = 'none'

/**
 * A distance in kilometres as a `NumberInput` value, or `''` when unset.
 * `distance_km` is a `numeric(8,2)` column, so it may arrive as a string.
 */
function toDistanceValue(km: number | string | null | undefined): number | string {
  if (km == null || km === '') {
    return ''
  }
  return typeof km === 'number' ? km : Number.parseFloat(km)
}

/**
 * What a successful read did, in one line. Every field it filled is already on
 * screen in the field it filled, so the note attributes the lot to the model
 * and asks for a check against the receipt rather than restating values the
 * member is looking at.
 */
function ReadFromReceipt({ filledNothing }: { filledNothing: boolean }) {
  return (
    <Alert color="info" variant="light" p="xs" title="Read from the receipt">
      <Text size="xs">
        {filledNothing
          ? 'Nothing on the receipt could be filled in for you.'
          : 'The details below were extracted from the receipt by AI — check them against it before saving.'}
      </Text>
    </Alert>
  )
}

/**
 * Where reading the first attached receipt has got to, shown under the file
 * picker. Every failure reads as what it is — the feature switched off, a file
 * that is not a receipt, one too large or of a type that cannot be read — and
 * none of them blocks the save: the details are typed by hand exactly as they
 * always were.
 */
function ExtractionNote({ state }: { state: ExtractionState }) {
  if (state.status === 'idle') {
    return null
  }
  if (state.status === 'uploading' || state.status === 'reading') {
    return (
      <Group gap="xs" role="status">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">
          {state.status === 'uploading' ? 'Storing the receipt…' : 'Reading the receipt…'}
        </Text>
      </Group>
    )
  }
  if (
    state.status === 'not-configured' ||
    state.status === 'out-of-credit' ||
    state.status === 'key-rejected'
  ) {
    // Off, not broken — a key never set, an account out of credit, or a key the
    // API refuses. Each names its own cause so the operator's fix is clear.
    return (
      <Text size="xs" c="dimmed">
        {state.message}
      </Text>
    )
  }
  if (state.status === 'not-receipt') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">
          {state.message}
          {state.reason !== null && ` ${state.reason}`} Enter the details by hand.
        </Text>
      </Alert>
    )
  }
  if (state.status === 'failed') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">{state.message}</Text>
      </Alert>
    )
  }
  return <ReadFromReceipt filledNothing={state.filledNothing} />
}

/**
 * One receipt already uploaded for a deduction not yet saved: the name it is
 * stored under, and a delete control. The name is seeded with the file's own
 * and freely retyped, so the member names the receipt on the way in rather than
 * renaming it from the list afterwards; cleared, it falls back to the `Receipt`
 * its placeholder shows. Each control is labelled by position, the name itself
 * being the thing under edit.
 */
function PendingReceiptItem({
  position,
  fileName,
  onRename,
  onDelete,
}: {
  position: number
  fileName: string
  onRename: (fileName: string) => void
  onDelete: () => void
}) {
  return (
    <Group gap="xs" wrap="nowrap">
      <TextInput
        size="xs"
        aria-label={`Receipt ${position} name`}
        placeholder={DEFAULT_RECEIPT_NAME}
        value={fileName}
        onChange={(event) => onRename(event.currentTarget.value)}
        style={{ flex: 1, minWidth: 0 }}
      />
      <ActionIcon
        variant="subtle"
        color="red"
        size="sm"
        aria-label={`Remove receipt ${position}`}
        onClick={onDelete}
      >
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  )
}

/**
 * Presentational add/edit form for a single deduction, tagged to the member the
 * section belongs to.
 *
 * Adding a deduction lets the member pick receipt files as the first step,
 * before the deduction exists: each picked file uploads immediately to Storage
 * under the id this form mints for the deduction, and the first one is read
 * through `deduction-extract` to pre-fill the description, amount, and date
 * that are not already the member's own — typed here already. A note says the
 * details were extracted by AI and asks for them to be checked; every failure
 * mode reads as its own inline note and never blocks the save, exactly as
 * payslip extraction does. Each picked file lists under a name field seeded
 * with the file's own name, so the receipt is stored under whatever the member
 * types — or `Receipt`, where the field is cleared. Saving writes the deduction
 * and every receipt already uploaded together, in one transaction
 * (`create_deduction_with_receipts`). A picked file the member removes, or the
 * whole add flow they cancel, is deleted again, best effort.
 *
 * Editing an existing deduction carries none of this: its receipts are managed
 * from its row in the deductions list, exactly as before, so this form shows
 * only its own fields.
 *
 * A deduction is entered on an **amount** basis (a dollar figure, typed
 * directly) or a **distance** basis (kilometres travelled for a work-related car
 * expense claimed under the ATO's cents-per-kilometre method), toggled by the
 * segmented control. On the distance basis the dollar amount is computed and
 * shown back, read-only, from `financialYear`'s published cents-per-km rate, and
 * a warning appears if the distance exceeds the ATO's cap on kilometres
 * claimable per car per year under this method — advisory only, it never blocks
 * a save. On the amount basis, "Amount" is what the expense cost in FULL, not
 * necessarily what is claimed: a "Work use %" field beside it (100 by default)
 * apportions it, showing back the claimable figure once the percentage departs
 * from 100. `full_amount_cents` and `work_use_percent` are the source figures;
 * `amount_cents` is the apportioned result every downstream reader uses, so
 * editing a part-claimed deduction reopens on its full cost — not the
 * apportioned amount — with the claim recomputed from it and the percentage. A
 * distance-basis claim is pinned at 100% work use, its kilometres being
 * work-related already; a percentage on top would discount the claim twice. The
 * basis, the distance, and the work-use percentage are all the member's own
 * throughout: a receipt read fills the description, amount, and date alone, so
 * none of them is pre-fillable and all stay outside `useDeductionFields`.
 */
export function DeductionForm({
  member,
  attachments,
  financialYear,
  groupId,
  groups = [],
  initial,
  onSubmit,
  onCancel,
}: DeductionFormProps) {
  const adding = initial === undefined

  const fields = useDeductionFields({
    description: initial?.description ?? '',
    // The full cost, not the apportioned amount_cents: editing a part-claimed
    // deduction re-opens on what it cost, with the claimed share recomputed from
    // it and the percentage below, rather than showing back a figure that was
    // itself derived.
    amount: centsToDollars(initial?.full_amount_cents ?? initial?.amount_cents),
    deductionDate: initial?.deduction_date ?? todayIso(),
  })
  const [basis, setBasis] = useState<Basis>(initial?.basis ?? 'amount')
  // Opened from a group the deduction belongs to that group and the picker is
  // not offered; otherwise it starts wherever the deduction already sits.
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(
    groupId ?? initial?.group_id ?? null,
  )
  const [distanceKm, setDistanceKm] = useState<number | string>(
    toDistanceValue(initial?.distance_km),
  )
  const [workUsePercent, setWorkUsePercent] = useState<number | string>(
    initial?.work_use_percent ?? 100,
  )
  const receipts = useDeductionAttachment({
    attachments,
    onExtracted: (extraction) => fields.prefill(extraction),
  })

  const { values } = fields
  const config = configsByYear[financialYear] ?? currentTaxConfig()
  const isDistance = basis === 'distance'
  const distanceKmNumber =
    typeof distanceKm === 'number' ? distanceKm : Number.parseFloat(distanceKm)
  const distanceValid =
    distanceKm !== '' && Number.isFinite(distanceKmNumber) && distanceKmNumber >= 0
  const computedAmountCents = distanceValid ? carExpenseDeductionCents(distanceKmNumber, config) : 0
  const overCap = isDistance && distanceValid && distanceKmNumber > config.carExpense.maxClaimableKm
  const fullAmountCents = dollarsToCents(values.amount) ?? 0
  const workUsePercentNumber =
    typeof workUsePercent === 'number' ? workUsePercent : Number.parseFloat(workUsePercent)
  const workUsePercentValid =
    workUsePercent !== '' &&
    Number.isFinite(workUsePercentNumber) &&
    workUsePercentNumber > 0 &&
    workUsePercentNumber <= 100
  const apportionedAmountCents = workUsePercentValid
    ? workUseAmountCents(fullAmountCents, workUsePercentNumber)
    : 0

  const canSubmit =
    values.description.trim() !== '' &&
    (isDistance ? distanceValid : values.amount !== '' && workUsePercentValid) &&
    values.deductionDate !== null &&
    // A save while a receipt is still being stored or read would send no
    // receipt for it, leaving the object filed under an id no row is written under.
    (!adding || !receipts.busy)

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this deduction. Please try again.',
    onSubmit,
    // The uploaded receipts belong to the saved row from here on, so they are
    // no longer cleaned up as objects nothing references.
    ...(adding && { onSuccess: receipts.keep }),
    buildInput: (): DeductionSubmission => ({
      id: initial?.id ?? receipts.deductionId,
      input: {
        member_id: member.id,
        description: values.description.trim(),
        amount_cents: isDistance ? computedAmountCents : apportionedAmountCents,
        deduction_date: values.deductionDate!,
        basis,
        distance_km: isDistance ? distanceKmNumber : null,
        group_id: groupId ?? pickedGroupId,
        // A distance-basis claim is work-related in full — its kilometres are
        // work kilometres already — so it is pinned at 100% regardless of
        // whatever the percentage field last held from an earlier amount-basis
        // edit; deduction_work_use_basis holds the database to the same rule.
        full_amount_cents: isDistance ? computedAmountCents : fullAmountCents,
        work_use_percent: isDistance ? 100 : workUsePercentNumber,
      },
      // A name left blank is a receipt named nothing, which stores as `Receipt`
      // rather than holding the save over a label.
      receipts: adding
        ? receipts.files.map((file) => ({ ...file, file_name: receiptName(file.file_name) }))
        : [],
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      // Inside a group the row being added is one payment of it, and the
      // button says so.
      addLabel={groupId ? 'payment' : 'deduction'}
      onCancel={onCancel}
    >
      {adding && (
        <Stack gap={6}>
          <FileInput
            label="Receipt"
            size="sm"
            description="Stored privately, then read to pre-fill the details below — which you confirm. Pick again to add another."
            placeholder="Attach a receipt"
            accept="image/*,application/pdf"
            disabled={receipts.busy}
            value={null}
            onChange={(file) => {
              if (file) {
                void receipts.addFile(file)
              }
            }}
          />
          <ExtractionNote state={receipts.state} />
          {receipts.files.map((file, index) => (
            <PendingReceiptItem
              key={file.storage_path}
              position={index + 1}
              fileName={file.file_name}
              onRename={(fileName) => receipts.renameFile(file.storage_path, fileName)}
              onDelete={() => void receipts.removeFile(file.storage_path)}
            />
          ))}
        </Stack>
      )}

      <TextInput
        label="Description"
        size="sm"
        placeholder="e.g. Home office running costs"
        value={values.description}
        onChange={(event) => fields.setDescription(event.currentTarget.value)}
      />

      <EnumSegmentedControl
        fullWidth
        size="sm"
        aria-label="Entry basis"
        value={basis}
        onChange={setBasis}
        data={[
          { value: 'amount', label: 'Dollar' },
          { value: 'distance', label: 'Distance (km)' },
        ]}
      />

      {isDistance ? (
        <>
          <NumberInput
            label="Kilometres travelled"
            size="sm"
            description={`Work-related kilometres travelled, at FY${financialYear}'s ${(config.carExpense.centsPerKm / 100).toFixed(2)}c/km ATO rate.`}
            suffix=" km"
            decimalScale={2}
            min={0}
            hideControls
            value={distanceKm}
            onChange={setDistanceKm}
          />
          <Text size="sm" c="dimmed">
            Deductible amount: <b>{formatCents(computedAmountCents)}</b>
          </Text>
          {overCap && (
            <Alert color="warning" variant="light" p="xs">
              <Text size="xs">
                Over the ATO's {config.carExpense.maxClaimableKm.toLocaleString()}km cap per car,
                per year for the cents-per-kilometre method. Kilometres beyond the cap need the
                logbook method or actual costs instead.
              </Text>
            </Alert>
          )}
        </>
      ) : (
        <>
          <MoneyInput
            label="Amount"
            size="sm"
            description="What the expense cost in full."
            min={0}
            hideControls
            value={values.amount}
            onChange={fields.setAmount}
          />
          <NumberInput
            label="Work use %"
            size="sm"
            description="The share used for work; 100% if it's for work only."
            suffix="%"
            decimalScale={2}
            min={0.01}
            max={100}
            hideControls
            value={workUsePercent}
            onChange={setWorkUsePercent}
          />
          {workUsePercentValid && workUsePercentNumber !== 100 && (
            <Text size="sm" c="dimmed">
              Deductible amount: <b>{formatCents(apportionedAmountCents)}</b>
            </Text>
          )}
        </>
      )}

      {groupId === undefined && groups.length > 0 && (
        <Select
          label="Group"
          size="sm"
          description="File this under a group, or leave it on its own."
          allowDeselect={false}
          data={[
            { value: NO_GROUP, label: 'None' },
            ...groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
          value={pickedGroupId ?? NO_GROUP}
          onChange={(value) =>
            setPickedGroupId(value === null || value === NO_GROUP ? null : value)
          }
        />
      )}

      <DateInput
        label="Date"
        size="sm"
        valueFormat="D MMM YYYY"
        value={values.deductionDate}
        onChange={fields.setDeductionDate}
      />
    </FormShell>
  )
}
