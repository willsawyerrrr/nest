import { ActionIcon, Anchor, FileInput, Group, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconTrash } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionInput, DeductionRow } from '../hooks/useDeductions'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { Member } from '../hooks/useMembers'
import { formatCents } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { DeductionForm } from './DeductionForm'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface DeductionsScreenProps {
  members: Member[]
  deductions: DeductionRow[]
  receipts: DeductionReceiptRow[]
  financialYear: number
  onCreate: (input: DeductionInput) => Promise<void>
  onUpdate: (id: string, input: DeductionInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUploadReceipt: (deductionId: string, file: File) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => Promise<void>
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

/** One stored receipt: its file name, a view link, and a delete control. */
function ReceiptItem({
  receipt,
  onView,
  onDelete,
}: {
  receipt: DeductionReceiptRow
  onView: () => void
  onDelete: () => void
}) {
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Anchor size="xs" component="button" type="button" onClick={onView} style={{ minWidth: 0 }}>
        <Text size="xs" truncate>
          {receipt.file_name}
        </Text>
      </Anchor>
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
  )
}

interface DeductionItemProps {
  deduction: DeductionRow
  receipts: DeductionReceiptRow[]
  onEdit: () => void
  onDelete: () => void
  onUploadReceipt: (file: File) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => void
  signedUrl: (path: string) => Promise<string | null>
}

/** A deduction's stored receipts and its upload control, shared by its row and card. */
function DeductionReceipts({
  deduction,
  receipts,
  onUploadReceipt,
  onRemoveReceipt,
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
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
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
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
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
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <DeductionRow {...props} /> : <DeductionCard {...props} />
}

/** A member's deductions with a running total, an add affordance, and inline forms. */
function MemberDeductions({
  member,
  deductions,
  receipts,
  onCreate,
  onUpdate,
  onDelete,
  onUploadReceipt,
  onRemoveReceipt,
  signedUrl,
}: {
  member: Member
  deductions: DeductionRow[]
  receipts: DeductionReceiptRow[]
  onCreate: (input: DeductionInput) => Promise<void>
  onUpdate: (id: string, input: DeductionInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUploadReceipt: (deductionId: string, file: File) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()
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

      {deductions.length === 0 && !adding && <EmptyState>No deductions yet.</EmptyState>}

      {deductions.map((deduction) =>
        editingId === deduction.id ? (
          <DeductionForm
            key={deduction.id}
            member={member}
            initial={deduction}
            onSubmit={async (input) => {
              await onUpdate(deduction.id, input)
              closeForms()
            }}
            onCancel={closeForms}
          />
        ) : (
          <DeductionItem
            key={deduction.id}
            deduction={deduction}
            receipts={receipts.filter((receipt) => receipt.deduction_id === deduction.id)}
            onEdit={() => startEditing(deduction.id)}
            onDelete={() =>
              confirm({
                title: 'Delete deduction?',
                itemLabel: deduction.description,
                onConfirm: () => onDelete(deduction.id),
              })
            }
            onUploadReceipt={(file) => onUploadReceipt(deduction.id, file)}
            onRemoveReceipt={(receipt) =>
              confirm({
                title: 'Delete receipt?',
                itemLabel: receipt.file_name,
                onConfirm: () => onRemoveReceipt(receipt),
              })
            }
            signedUrl={signedUrl}
          />
        ),
      )}

      {adding ? (
        <DeductionForm
          member={member}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <AddButton label="Add deduction" onClick={() => startAdding(true)} />
      )}

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
  onCreate,
  onUpdate,
  onDelete,
  onUploadReceipt,
  onRemoveReceipt,
  signedUrl,
}: DeductionsScreenProps) {
  return (
    <PageSection
      title={`Tax deductions (FY${financialYear})`}
      intro="Each member’s deductible expenses for the financial year, with receipts stored privately. A member’s deductions reduce their taxable income on the Tax tab, lowering their estimated tax and lifting take-home on the Summary."
    >
      {members.map((member) => (
        <MemberDeductions
          key={member.id}
          member={member}
          deductions={deductions.filter((deduction) => deduction.member_id === member.id)}
          receipts={receipts}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onUploadReceipt={onUploadReceipt}
          onRemoveReceipt={onRemoveReceipt}
          signedUrl={signedUrl}
        />
      ))}
    </PageSection>
  )
}
