import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  FileButton,
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
  UPLOAD_FAILED_MESSAGE,
  useDeductionAttachment,
  type DeductionAttachments,
  type ExtractionState,
} from '../hooks/useDeductionAttachment'
import { useDeductionFields } from '../hooks/useDeductionFields'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionCategory, DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents, formatCents, workUseAmountCents } from '../lib/money'
import { currentTaxConfig } from '../lib/tax'
import { prepareUpload } from '../lib/uploadFile'
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
   * Omitted, an edit keeps whatever group the deduction already sits in, a new
   * work expense or tax agent fee stands on its own, and a new donation is
   * filed into the member's donations group by the database trigger. A donations
   * group holds donations alone and a donation sits in no other group, so the
   * group's kind decides which categories the form offers.
   */
  groupId?: string | undefined
  /**
   * The member's groups for this financial year. The standard ones are offered
   * as a picker so a non-donation can be filed under one — or taken out of one —
   * after the fact; a donation has no picker. No standard group, or a form
   * opened from a group, shows no picker.
   */
  groups?: DeductionGroupRow[]
  initial?: DeductionRow | undefined
  /** When editing, the deduction's stored receipt, if it has one. */
  receipt?: DeductionReceiptRow | undefined
  /** When editing, stores a file as the deduction's receipt, replacing any current one. */
  onUploadReceipt?: ((file: File) => Promise<void>) | undefined
  /** When editing, removes the stored receipt. */
  onRemoveReceipt?: ((receipt: DeductionReceiptRow) => void) | undefined
  onSubmit: (submission: DeductionSubmission) => void | Promise<void>
  onCancel?: () => void
}

type Basis = DeductionRow['basis']

/** The category picker's options, in the order shown. */
const CATEGORY_OPTIONS: { value: DeductionCategory; label: string }[] = [
  { value: 'work_expense', label: 'Work expense' },
  { value: 'donation', label: 'Donation' },
  { value: 'tax_agent_fees', label: 'Tax agent fee' },
]

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
    state.status === 'key-rejected' ||
    state.status === 'unsupported'
  ) {
    // Off, not broken — a key never set, an account out of credit, a key the
    // API refuses, or a file type the model cannot read.
    // Each names its own cause so the operator's fix is clear.
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
 * Presentational add/edit form for a single deduction, tagged to the member the
 * section belongs to.
 *
 * Adding a deduction lets the member pick its receipt as the first step,
 * before the deduction exists: the file uploads immediately to Storage under
 * the id this form mints for the deduction, and is read through
 * `deduction-extract` to pre-fill the description, amount, and date that are
 * not already the member's own — typed here already. A note says the details
 * were extracted by AI and asks for them to be checked; every failure mode
 * reads as its own inline note and never blocks the save, exactly as payslip
 * extraction does. Picking another file replaces the first. Saving writes the
 * deduction and its uploaded receipt together, in one transaction
 * (`create_deduction_with_receipt`). A file the member removes or replaces, or
 * the whole add flow they cancel, is deleted again, best effort.
 *
 * Editing an existing deduction carries none of the extraction: its receipt is
 * attached, replaced, or removed from a control here that writes straight
 * through, since the deduction already exists, and nothing is read.
 *
 * Adding starts with **what kind of deduction** this is — a work expense (the
 * default), a donation, or a tax agent fee — asked up front, before the receipt
 * is picked: it primes `deduction-extract` to expect the right kind of document
 * (a purchase receipt/invoice, a donation tax receipt, or an invoice) rather
 * than rejecting a genuine donation tax receipt for not being a purchase. The
 * category is fixed once the deduction exists (`deduction_category_immutable`),
 * so editing offers no picker for it.
 *
 * Editing stays near the row's own footprint: the description, the amount (or
 * kilometres), and the date sit on two lines, with explanatory hints dropped.
 * The rest — work use %, the group, and the receipt controls — sits behind a
 * "More details" toggle that starts open only when the deduction already uses
 * one of them (a part-claimed work use or a group). Adding shows every field.
 *
 * A **donation** is grouped automatically: saved with no group of its own, the
 * `file_donation_in_default_group` trigger files it into the member's donations
 * group for the year, and it can sit in no other. A donation therefore has no
 * group picker, and the picker lists only the member's standard groups, since a
 * donations group holds donations alone.
 *
 * A **work expense** is entered on an **amount** basis (a dollar figure, typed
 * directly) or a **distance** basis (kilometres travelled for a work-related car
 * expense claimed under the ATO's cents-per-kilometre method), toggled by the
 * segmented control when adding. The basis is fixed once the deduction exists
 * (`deduction_basis_immutable`), so editing offers no toggle: a deduction on the
 * wrong basis is deleted and re-added. The toggle is shown for a work expense alone: a **donation**
 * or a **tax agent fee** is always a plain dollar figure — a distance prices
 * nothing there — so it is entered on the amount basis with no choice offered.
 * On the distance basis the dollar amount is computed and
 * shown back, read-only, from `financialYear`'s published cents-per-km rate, and
 * a warning appears if the distance exceeds the ATO's cap on kilometres
 * claimable per car per year under this method — advisory only, it never blocks
 * a save. On the amount basis, for a **work expense**, "Amount" is what the
 * expense cost in FULL, not necessarily what is claimed: a "Work use %" field
 * beside it (100 by default) apportions it, showing back the claimable figure
 * once the percentage departs from 100. `full_amount_cents` and
 * `work_use_percent` are the source figures; `amount_cents` is the apportioned
 * result every downstream reader uses, so editing a part-claimed deduction
 * reopens on its full cost — not the apportioned amount — with the claim
 * recomputed from it and the percentage. Work use is pinned at 100% and the
 * field is hidden wherever apportioning does not apply: on the distance basis,
 * whose kilometres are work-related already, and for a **donation** or
 * **tax agent fee**, which is claimed in full or not at all — a percentage on
 * top would discount the claim twice, or make no sense at all. The category,
 * the basis (for a work expense), the distance, and the work-use percentage are
 * all the member's own throughout: a receipt read fills the description, amount,
 * and date alone, so none of them is pre-fillable and all stay outside
 * `useDeductionFields`.
 */
export function DeductionForm({
  member,
  attachments,
  financialYear,
  groupId,
  groups = [],
  initial,
  receipt,
  onUploadReceipt,
  onRemoveReceipt,
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
  // Chosen when adding; an existing deduction keeps the basis it was created
  // with, since a deduction on the wrong one is deleted and re-added.
  // Why the receipt picked on an existing deduction was not attached.
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const replaceReceipt = async (file: File, upload: (file: File) => Promise<void>) => {
    setReceiptError(null)
    const prepared = await prepareUpload(file)
    if (prepared.status === 'too-large') {
      setReceiptError(prepared.message)
      return
    }
    try {
      await upload(prepared.file)
    } catch {
      setReceiptError(UPLOAD_FAILED_MESSAGE)
    }
  }
  const [chosenBasis, setBasis] = useState<Basis>('amount')
  const basis = initial?.basis ?? chosenBasis
  // Opened from a group, the deduction belongs to that group and the picker is
  // not offered; the group's kind then decides the categories on offer.
  const openedFrom = groupId === undefined ? undefined : groups.find((g) => g.id === groupId)
  const [category, setCategory] = useState<DeductionCategory>(
    initial?.category ?? (openedFrom?.kind === 'donations' ? 'donation' : 'work_expense'),
  )
  const standardGroups = groups.filter((group) => group.kind === 'standard')
  // Otherwise the picker starts wherever the deduction already sits, a
  // donations group reading as no group (it is not offered, and a donation
  // leaving it for another category stands alone).
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(() => {
    const start = groupId ?? initial?.group_id ?? null
    return standardGroups.some((group) => group.id === start) ? start : null
  })
  const [distanceKm, setDistanceKm] = useState<number | string>(
    toDistanceValue(initial?.distance_km),
  )
  const [workUsePercent, setWorkUsePercent] = useState<number | string>(
    initial?.work_use_percent ?? 100,
  )
  // Adding shows every field. Editing keeps the form to the description, the
  // amount (or distance), and the date, with the rest behind a toggle that
  // starts open only when the deduction already departs from the defaults.
  const [detailsToggled, setDetailsToggled] = useState(
    initial !== undefined &&
      (initial.work_use_percent < 100 ||
        (initial.group_id !== null && initial.category !== 'donation')),
  )
  const showDetails = adding || detailsToggled
  const hint = (text: string) => (adding ? text : undefined)
  const receipts = useDeductionAttachment({
    attachments,
    category,
    onExtracted: (extraction) => fields.prefill(extraction),
  })

  const { values } = fields
  const config = configsByYear[financialYear] ?? currentTaxConfig()
  // The dollar/distance choice is a work-expense concern alone: a donation or a
  // tax agent fee is always a dollar figure, so the picker is hidden and the
  // basis forced to 'amount' — whatever an earlier work-expense edit left in
  // `basis`. `deduction_distance_basis_work_expense` holds the same rule in the
  // database.
  const basisApplies = category === 'work_expense'
  const effectiveBasis: Basis = basisApplies ? basis : 'amount'
  const isDistance = effectiveBasis === 'distance'
  // A donation is filed into the donations group by the database, so it has no
  // picker; a donations group holds donations alone, so a form opened from one
  // offers no other category, and one opened from a standard group no donation.
  const isDonation = category === 'donation'
  const categoryOptions =
    openedFrom?.kind === 'standard'
      ? CATEGORY_OPTIONS.filter((option) => option.value !== 'donation')
      : CATEGORY_OPTIONS
  const distanceKmNumber =
    typeof distanceKm === 'number' ? distanceKm : Number.parseFloat(distanceKm)
  const distanceValid =
    distanceKm !== '' && Number.isFinite(distanceKmNumber) && distanceKmNumber >= 0
  const computedAmountCents = distanceValid ? carExpenseDeductionCents(distanceKmNumber, config) : 0
  const overCap = isDistance && distanceValid && distanceKmNumber > config.carExpense.maxClaimableKm
  const fullAmountCents = dollarsToCents(values.amount) ?? 0
  // Work use is pinned to 100% wherever it cannot be apportioned: the distance
  // basis, whose kilometres are work-related already, or a non-work-expense
  // category — a donation and tax agent fees are claimed in full or not at
  // all, never split by work use.
  const apportionable = !isDistance && category === 'work_expense'
  const enteredWorkUsePercent =
    typeof workUsePercent === 'number' ? workUsePercent : Number.parseFloat(workUsePercent)
  const workUsePercentValid =
    !apportionable ||
    (workUsePercent !== '' &&
      Number.isFinite(enteredWorkUsePercent) &&
      enteredWorkUsePercent > 0 &&
      enteredWorkUsePercent <= 100)
  const showWorkUse = showDetails && apportionable
  const showGroupPicker =
    showDetails && groupId === undefined && !isDonation && standardGroups.length > 0
  const workUsePercentNumber = apportionable ? enteredWorkUsePercent : 100
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
        basis: effectiveBasis,
        distance_km: isDistance ? distanceKmNumber : null,
        group_id: isDonation ? null : (groupId ?? pickedGroupId),
        category,
        // Pinned at 100% wherever it cannot be apportioned, regardless of
        // whatever the percentage field last held from an earlier
        // work-expense/amount-basis edit; deduction_work_use_basis holds the
        // database to the same rule.
        full_amount_cents: isDistance ? computedAmountCents : fullAmountCents,
        work_use_percent: workUsePercentNumber,
      },
      receiptPath: adding ? receipts.path : null,
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
      {adding && openedFrom?.kind !== 'donations' && (
        <EnumSegmentedControl
          fullWidth
          size="sm"
          aria-label="What kind of deduction?"
          value={category}
          onChange={setCategory}
          data={categoryOptions}
        />
      )}

      {adding && (
        <Stack gap={6}>
          <FileInput
            label="Receipt"
            size="sm"
            description="Any file, up to 25 MB. Stored privately, then read to pre-fill the details below where it can be — which you confirm. Pick again to replace it."
            placeholder="Attach a receipt"
            disabled={receipts.busy}
            value={null}
            onChange={(file) => {
              if (file) {
                void receipts.addFile(file)
              }
            }}
          />
          <ExtractionNote state={receipts.state} />
          {receipts.path !== null && (
            <Group gap="xs" wrap="nowrap" justify="space-between">
              <Text size="xs">Receipt attached</Text>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                aria-label="Remove receipt"
                onClick={() => void receipts.removeFile()}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          )}
        </Stack>
      )}

      <TextInput
        label="Description"
        size="sm"
        placeholder="e.g. Home office running costs"
        value={values.description}
        onChange={(event) => fields.setDescription(event.currentTarget.value)}
      />

      <Group grow wrap="nowrap" align="flex-start" gap="xs">
        {isDistance ? (
          <NumberInput
            label="Kilometres travelled"
            size="sm"
            description={hint(
              `Work-related kilometres travelled, at FY${financialYear}'s ${(config.carExpense.centsPerKm / 100).toFixed(2)}c/km ATO rate.`,
            )}
            suffix=" km"
            decimalScale={2}
            min={0}
            hideControls
            value={distanceKm}
            onChange={setDistanceKm}
          />
        ) : (
          <MoneyInput
            label="Amount"
            size="sm"
            description={hint(
              apportionable
                ? 'What the expense cost in full.'
                : 'The receipted amount, claimed in full.',
            )}
            min={0}
            hideControls
            value={values.amount}
            onChange={fields.setAmount}
          />
        )}
        <DateInput
          label="Date"
          size="sm"
          valueFormat="D MMM YYYY"
          value={values.deductionDate}
          onChange={fields.setDeductionDate}
        />
      </Group>

      {isDistance && (
        <Text size="sm" c="dimmed">
          Deductible amount: <b>{formatCents(computedAmountCents)}</b>
        </Text>
      )}
      {overCap && (
        <Alert color="warning" variant="light" p="xs">
          <Text size="xs">
            Over the ATO's {config.carExpense.maxClaimableKm.toLocaleString()}km cap per car, per
            year for the cents-per-kilometre method. Kilometres beyond the cap need the logbook
            method or actual costs instead.
          </Text>
        </Alert>
      )}

      {!adding && (
        <Anchor
          component="button"
          type="button"
          size="xs"
          ta="left"
          aria-expanded={detailsToggled}
          onClick={() => setDetailsToggled((open) => !open)}
        >
          {detailsToggled ? 'Fewer details' : 'More details'}
        </Anchor>
      )}

      {adding && basisApplies && (
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
      )}

      {(showWorkUse || showGroupPicker) && (
        <Group align="flex-start" gap="xs" wrap="wrap">
          {showWorkUse && (
            <NumberInput
              label="Work use %"
              size="sm"
              description={hint("The share used for work; 100% if it's for work only.")}
              suffix="%"
              decimalScale={2}
              min={0.01}
              max={100}
              hideControls
              value={workUsePercent}
              onChange={setWorkUsePercent}
              style={showGroupPicker ? { flex: '0 0 7rem' } : { flex: '1 1 100%' }}
            />
          )}
          {showGroupPicker && (
            <Select
              label="Group"
              size="sm"
              description="File this under a group, or leave it on its own."
              allowDeselect={false}
              data={[
                { value: NO_GROUP, label: 'None' },
                ...standardGroups.map((group) => ({ value: group.id, label: group.name })),
              ]}
              value={pickedGroupId ?? NO_GROUP}
              onChange={(value) =>
                setPickedGroupId(value === null || value === NO_GROUP ? null : value)
              }
              style={{ flex: '1 1 12rem' }}
            />
          )}
        </Group>
      )}
      {showWorkUse && workUsePercentValid && workUsePercentNumber !== 100 && (
        <Text size="sm" c="dimmed">
          Deductible amount: <b>{formatCents(apportionedAmountCents)}</b>
        </Text>
      )}

      {showDetails && !adding && onUploadReceipt && (
        <Group gap="xs" wrap="nowrap">
          <FileButton
            inputProps={{ 'aria-label': `${receipt ? 'Replace' : 'Add'} receipt` }}
            onChange={(file) => {
              if (file) {
                void replaceReceipt(file, onUploadReceipt)
              }
            }}
          >
            {(props) => (
              <Button {...props} variant="default" size="xs">
                {receipt ? 'Replace receipt' : 'Add receipt'}
              </Button>
            )}
          </FileButton>
          {receipt && onRemoveReceipt && (
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              aria-label="Delete receipt"
              onClick={() => onRemoveReceipt(receipt)}
            >
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
      )}
      {receiptError !== null && (
        <Text size="xs" c="red" role="alert">
          {receiptError}
        </Text>
      )}
    </FormShell>
  )
}
