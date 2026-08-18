import { ActionIcon, Alert, FileInput, Group, Loader, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconTrash } from '@tabler/icons-react'
import {
  useDeductionAttachment,
  type DeductionAttachments,
  type ExtractionState,
} from '../hooks/useDeductionAttachment'
import { useDeductionFields } from '../hooks/useDeductionFields'
import type { DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface DeductionFormProps {
  member: { id: string; name: string }
  /** Storing, discarding, and reading receipts picked before the deduction exists. */
  attachments: DeductionAttachments
  initial?: DeductionRow | undefined
  onSubmit: (submission: DeductionSubmission) => void | Promise<void>
  onCancel?: () => void
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

/** One receipt already uploaded for a deduction not yet saved, with a delete control. */
function PendingReceiptItem({ fileName, onDelete }: { fileName: string; onDelete: () => void }) {
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Text size="xs" truncate style={{ minWidth: 0, flex: 1 }}>
        {fileName}
      </Text>
      <ActionIcon
        variant="subtle"
        color="red"
        size="sm"
        aria-label={`Remove ${fileName}`}
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
 * payslip extraction does. Saving writes the deduction and every receipt
 * already uploaded together, in one transaction
 * (`create_deduction_with_receipts`). A picked file the member removes, or the
 * whole add flow they cancel, is deleted again, best effort.
 *
 * Editing an existing deduction carries none of this: its receipts are managed
 * from its row in the deductions list, exactly as before, so this form shows
 * only its own fields.
 */
export function DeductionForm({
  member,
  attachments,
  initial,
  onSubmit,
  onCancel,
}: DeductionFormProps) {
  const adding = initial === undefined

  const fields = useDeductionFields({
    description: initial?.description ?? '',
    amount: centsToDollars(initial?.amount_cents),
    deductionDate: initial?.deduction_date ?? todayIso(),
  })
  const receipts = useDeductionAttachment({
    attachments,
    onExtracted: (extraction) => fields.prefill(extraction),
  })

  const { values } = fields
  const canSubmit =
    values.description.trim() !== '' &&
    values.amount !== '' &&
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
        amount_cents: dollarsToCents(values.amount) ?? 0,
        deduction_date: values.deductionDate!,
      },
      receipts: adding ? receipts.files : [],
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="deduction"
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
          {receipts.files.map((file) => (
            <PendingReceiptItem
              key={file.storage_path}
              fileName={file.file_name}
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

      <MoneyInput
        label="Amount"
        size="sm"
        description="The deductible amount."
        min={0}
        hideControls
        value={values.amount}
        onChange={fields.setAmount}
      />

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
