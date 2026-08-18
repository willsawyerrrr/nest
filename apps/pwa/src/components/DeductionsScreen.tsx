import { useState } from 'react'
import { ActionIcon, Anchor, FileInput, Group, Stack, Text, TextInput } from '@mantine/core'
import { IconCheck, IconPencil, IconTrash, IconX } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionInput, DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import { formatCents } from '../lib/money'
import { AppCard } from './AppCard'
import { DeductionForm } from './DeductionForm'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface DeductionsScreenProps {
  members: Member[]
  deductions: DeductionRow[]
  receipts: DeductionReceiptRow[]
  financialYear: number
  /** Storing, discarding, and reading receipts picked before a new deduction exists. */
  attachments: DeductionAttachments
  onCreate: (submission: DeductionSubmission) => Promise<void>
  onUpdate: (id: string, input: DeductionInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUploadReceipt: (deductionId: string, file: File) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => Promise<void>
  onRenameReceipt: (receipt: DeductionReceiptRow, fileName: string) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}

/** A day-month-year label for an ISO date string, built without a timezone shift. */
function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * One stored receipt: its file name, a view link, a rename control, and a
 * delete control. Renaming swaps the label for a text field with save/cancel
 * controls beside it, matching the pencil/check pair `NetWorthView`'s own edit
 * toggle uses. Saving is blocked while the name is blank, matching the rest of
 * the app's disable-rather-than-error validation; the underlying stored file
 * and its path are never touched, only the display label.
 */
function ReceiptItem({
  receipt,
  onView,
  onDelete,
  onRename,
}: {
  receipt: DeductionReceiptRow
  onView: () => void
  onDelete: () => void
  onRename: (fileName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(receipt.file_name)

  const startEditing = () => {
    setDraft(receipt.file_name)
    setEditing(true)
  }
  const cancel = () => setEditing(false)
  const trimmed = draft.trim()
  const canSave = trimmed !== ''
  const save = () => {
    if (!canSave) {
      return
    }
    onRename(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <Group gap={4} wrap="nowrap">
        <TextInput
          size="xs"
          aria-label={`Rename ${receipt.file_name}`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            } else if (event.key === 'Escape') {
              cancel()
            }
          }}
          style={{ flex: 1, minWidth: 0 }}
          autoFocus
        />
        <ActionIcon
          variant="subtle"
          color="teal"
          size="sm"
          aria-label={`Save name for ${receipt.file_name}`}
          disabled={!canSave}
          onClick={save}
        >
          <IconCheck size={14} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={`Cancel renaming ${receipt.file_name}`}
          onClick={cancel}
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>
    )
  }

  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Anchor size="xs" component="button" type="button" onClick={onView} style={{ minWidth: 0 }}>
        <Text size="xs" truncate>
          {receipt.file_name}
        </Text>
      </Anchor>
      <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={`Rename ${receipt.file_name}`}
          onClick={startEditing}
        >
          <IconPencil size={14} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          aria-label={`Delete receipt ${receipt.file_name}`}
          onClick={onDelete}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Group>
    </Group>
  )
}

interface DeductionItemProps {
  deduction: DeductionRow
  receipts: DeductionReceiptRow[]
  onEdit: () => void
  onDelete: () => void
  onUploadReceipt: (file: File) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => void
  onRenameReceipt: (receipt: DeductionReceiptRow, fileName: string) => void
  signedUrl: (path: string) => Promise<string | null>
}

/** A deduction's stored receipts and its upload control, shared by its row and card. */
function DeductionReceipts({
  deduction,
  receipts,
  onUploadReceipt,
  onRemoveReceipt,
  onRenameReceipt,
  signedUrl,
}: Omit<DeductionItemProps, 'onEdit' | 'onDelete'>) {
  const viewReceipt = async (receipt: DeductionReceiptRow) => {
    const url = await signedUrl(receipt.storage_path)
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  return (
    <Stack gap={6}>
      {receipts.map((receipt) => (
        <ReceiptItem
          key={receipt.id}
          receipt={receipt}
          onView={() => void viewReceipt(receipt)}
          onDelete={() => onRemoveReceipt(receipt)}
          onRename={(fileName) => onRenameReceipt(receipt, fileName)}
        />
      ))}

      <FileInput
        size="xs"
        variant="light"
        placeholder="Add receipt"
        accept="image/*,application/pdf"
        aria-label={`Add receipt for ${deduction.description}`}
        value={null}
        onChange={(file) => {
          if (file) {
            void onUploadReceipt(file)
          }
        }}
      />
    </Stack>
  )
}

/**
 * One deduction as a dense table-like row for desktop: the description grows with
 * its date as a dimmed suffix, its amount right-aligned in a fixed column, the
 * controls at the end, and its receipts and upload on the caption line beneath.
 */
function DeductionRow({ deduction, onEdit, onDelete, ...receiptProps }: DeductionItemProps) {
  return (
    <ListRow caption={<DeductionReceipts deduction={deduction} {...receiptProps} />}>
      <Group gap={6} wrap="nowrap" align="baseline" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
          {deduction.description}
        </Text>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {formatIsoDate(deduction.deduction_date)}
        </Text>
      </Group>
      <MoneyText
        cents={deduction.amount_cents}
        fw={700}
        size="sm"
        ta="right"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One deduction as a compact bordered card for mobile: description over its facts and receipts. */
function DeductionCard({ deduction, onEdit, onDelete, ...receiptProps }: DeductionItemProps) {
  return (
    <AppCard withBorder padding="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              {deduction.description}
            </Text>
            <Text size="xs" c="dimmed">
              {formatIsoDate(deduction.deduction_date)}
            </Text>
          </Stack>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <MoneyText cents={deduction.amount_cents} fw={700} size="sm" />
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>

        <DeductionReceipts deduction={deduction} {...receiptProps} />
      </Stack>
    </AppCard>
  )
}

/**
 * A single deduction, rendered as a dense table-like row from the `sm` breakpoint
 * up and as a compact bordered card below it.
 */
function DeductionItem(props: DeductionItemProps) {
  const wide = useIsWide()
  return wide ? <DeductionRow {...props} /> : <DeductionCard {...props} />
}

/** A member's deductions with a running total, an add affordance, and inline forms. */
function MemberDeductions({
  member,
  deductions,
  receipts,
  attachments,
  onCreate,
  onUpdate,
  onDelete,
  onUploadReceipt,
  onRemoveReceipt,
  onRenameReceipt,
  signedUrl,
}: {
  member: Member
  deductions: DeductionRow[]
  receipts: DeductionReceiptRow[]
  attachments: DeductionAttachments
  onCreate: (submission: DeductionSubmission) => Promise<void>
  onUpdate: (id: string, input: DeductionInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUploadReceipt: (deductionId: string, file: File) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => Promise<void>
  onRenameReceipt: (receipt: DeductionReceiptRow, fileName: string) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}) {
  // A second confirm dialog for a deduction's receipts; the deduction's own
  // delete is owned by the EditableList. Only one is ever open at a time.
  const { confirm, modal } = useConfirmDelete()

  const totalCents = deductions.reduce((total, deduction) => total + deduction.amount_cents, 0)

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600}>{member.name}</Text>
        <Text fw={600} size="sm">
          {formatCents(totalCents)}
        </Text>
      </Group>

      <EditableList<DeductionRow, DeductionSubmission>
        items={deductions}
        addLabel="Add deduction"
        emptyMessage="No deductions yet."
        deleteTarget={(deduction) => ({
          title: 'Delete deduction?',
          itemLabel: deduction.description,
        })}
        onCreate={onCreate}
        // Editing goes straight to a plain field update — the RPC that writes
        // receipts alongside a new deduction is never reached here, so the
        // receipts already on this deduction (managed from its row below) are
        // never replaced by the empty set an edit form's submission carries.
        onUpdate={(id, submission) => onUpdate(id, submission.input)}
        onDelete={onDelete}
        renderItem={(deduction, { onEdit, onDelete: onDeleteItem }) => (
          <DeductionItem
            deduction={deduction}
            receipts={receipts.filter((receipt) => receipt.deduction_id === deduction.id)}
            onEdit={onEdit}
            onDelete={onDeleteItem}
            onUploadReceipt={(file) => onUploadReceipt(deduction.id, file)}
            onRemoveReceipt={(receipt) =>
              confirm({
                title: 'Delete receipt?',
                itemLabel: receipt.file_name,
                onConfirm: () => onRemoveReceipt(receipt),
              })
            }
            onRenameReceipt={(receipt, fileName) => void onRenameReceipt(receipt, fileName)}
            signedUrl={signedUrl}
          />
        )}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <DeductionForm
            member={member}
            attachments={attachments}
            initial={initial}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      />

      {modal}
    </Stack>
  )
}

/**
 * Presentational deductions manager: one grouped list per household member, each
 * deduction showing its amount and date with its stored receipts, an upload
 * affordance, and a running per-member total. Persistence lives in the caller.
 */
export function DeductionsScreen({
  members,
  deductions,
  receipts,
  financialYear,
  attachments,
  onCreate,
  onUpdate,
  onDelete,
  onUploadReceipt,
  onRemoveReceipt,
  onRenameReceipt,
  signedUrl,
}: DeductionsScreenProps) {
  return (
    <PageSection
      title={`Tax deductions (FY${financialYear})`}
      intro="Each member’s deductible expenses for the financial year, with receipts stored privately — pick receipts before saving a new deduction and their details are read for you to check. A member’s deductions reduce their taxable income on the Tax tab, lowering their estimated tax and lifting take-home on the Summary."
    >
      {members.map((member) => (
        <MemberDeductions
          key={member.id}
          member={member}
          deductions={deductions.filter((deduction) => deduction.member_id === member.id)}
          receipts={receipts}
          attachments={attachments}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onUploadReceipt={onUploadReceipt}
          onRemoveReceipt={onRemoveReceipt}
          onRenameReceipt={onRenameReceipt}
          signedUrl={signedUrl}
        />
      ))}
    </PageSection>
  )
}
