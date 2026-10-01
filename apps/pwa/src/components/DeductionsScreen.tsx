import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Group, Stack, Text } from '@mantine/core'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupInput, DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionInput, DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import type { Member } from '../hooks/useMembers'
import { droppedGroupId, groupDropId, UNGROUPED_DROP_ID } from '../lib/deductionDrop'
import { formatCents } from '../lib/money'
import { AppCard } from './AppCard'
import { DropTarget } from './DeductionDrop'
import { DeductionForm } from './DeductionForm'
import { DeductionGroup, DeductionGroupForm } from './DeductionGroup'
import { DeductionItem, DraggableDeduction } from './DeductionItem'
import { DeductionReceiptImport } from './DeductionReceiptImport'
import { EditableList, type ItemControls } from './EditableList'
import { FinancialYearSelect } from './FinancialYearSelect'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface DeductionsScreenProps {
  members: Member[]
  deductions: DeductionRow[]
  /** The recurring expenses the deductions above are read through, for this year. */
  groups: DeductionGroupRow[]
  receipts: DeductionReceiptRow[]
  financialYear: number
  /** Financial years with a published tax config, most recent first. */
  availableFinancialYears: readonly number[]
  onFinancialYearChange: (financialYear: number) => void
  /** Storing, discarding, and reading receipts picked before a new deduction exists. */
  attachments: DeductionAttachments
  onCreate: (submission: DeductionSubmission) => Promise<void>
  onUpdate: (id: string, input: DeductionInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCreateGroup: (input: DeductionGroupInput) => Promise<void>
  onUpdateGroup: (id: string, input: DeductionGroupInput) => Promise<void>
  onDeleteGroup: (id: string) => Promise<void>
  onUploadReceipt: (
    deductionId: string,
    file: File,
    existing?: DeductionReceiptRow,
  ) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}

/**
 * A member's deductions with a running total, an add affordance, and inline
 * forms.
 *
 * A group of deductions — a subscription paid monthly, a trip's several
 * receipts, anything claimed in more than one payment — collapses to one row
 * carrying the name, the payment count, and the total, expandable to the
 * payments themselves. Each payment is an ordinary deduction — its own date,
 * amount, and receipt — so the member's total below counts grouped and
 * ungrouped rows alike, and grouping never changes what is claimed.
 *
 * A payment's grip handle drags it onto a group to file it there, between
 * groups to move it, or onto the ungrouped list to take it out; the groups and
 * list that would accept it are outlined while it is dragged. The drag context
 * is this member's own, and its groups are this year's, so every target shown
 * is one the deduction's composite reference accepts. The form's Group picker
 * is the keyboard path.
 */
function MemberDeductions({
  member,
  deductions,
  groups,
  receipts,
  attachments,
  financialYear,
  onCreate,
  onUpdate,
  onDelete,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onUploadReceipt,
  onRemoveReceipt,
  signedUrl,
}: {
  member: Member
  deductions: DeductionRow[]
  groups: DeductionGroupRow[]
  receipts: DeductionReceiptRow[]
  attachments: DeductionAttachments
  financialYear: number
  onCreate: (submission: DeductionSubmission) => Promise<void>
  onUpdate: (id: string, input: DeductionInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCreateGroup: (input: DeductionGroupInput) => Promise<void>
  onUpdateGroup: (id: string, input: DeductionGroupInput) => Promise<void>
  onDeleteGroup: (id: string) => Promise<void>
  onUploadReceipt: (
    deductionId: string,
    file: File,
    existing?: DeductionReceiptRow,
  ) => Promise<void>
  onRemoveReceipt: (receipt: DeductionReceiptRow) => Promise<void>
  signedUrl: (path: string) => Promise<string | null>
}) {
  // A second confirm dialog for a deduction's receipt; the deduction's own
  // delete is owned by the EditableList. Only one is ever open at a time.
  const { confirm, modal } = useConfirmDelete()

  // The member's total counts every deduction, grouped or not — a group is a
  // reading of rows that are each claimed in their own right.
  const totalCents = deductions.reduce((total, deduction) => total + deduction.amount_cents, 0)
  const ungrouped = deductions.filter((deduction) => deduction.group_id === null)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const dragging = deductions.find((deduction) => deduction.id === draggingId)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )
  const isValidTarget = (dropId: string) =>
    dragging !== undefined && droppedGroupId(dragging, dropId, groups) !== undefined

  const handleDragStart = (event: DragStartEvent) => {
    setMoveError(null)
    setDraggingId(String(event.active.id))
  }
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null)
    const deduction = deductions.find((candidate) => candidate.id === String(event.active.id))
    if (!deduction || !event.over) {
      return
    }
    const groupId = droppedGroupId(deduction, String(event.over.id), groups)
    if (groupId === undefined) {
      return
    }
    // The whole row is written back, as any other edit does, with only its
    // group changed; group totals are summed from the rows, so they follow.
    onUpdate(deduction.id, {
      member_id: deduction.member_id,
      description: deduction.description,
      amount_cents: deduction.amount_cents,
      deduction_date: deduction.deduction_date,
      basis: deduction.basis,
      distance_km: deduction.distance_km,
      full_amount_cents: deduction.full_amount_cents,
      work_use_percent: deduction.work_use_percent,
      category: deduction.category,
      group_id: groupId,
    }).catch(() => setMoveError('Could not move this deduction. Please try again.'))
  }

  const receiptFor = (deduction: DeductionRow) =>
    receipts.find((candidate) => candidate.deduction_id === deduction.id)

  // The edit form's receipt controls for one deduction: attach or replace a
  // file, or remove the stored one after a confirm.
  const receiptControls = (deduction: DeductionRow) => ({
    receipt: receiptFor(deduction),
    onUploadReceipt: (file: File) => onUploadReceipt(deduction.id, file, receiptFor(deduction)),
    onRemoveReceipt: (current: DeductionReceiptRow) =>
      confirm({
        title: 'Delete receipt?',
        itemLabel: `the receipt for ${deduction.description}`,
        onConfirm: () => onRemoveReceipt(current),
      }),
  })

  // One payment, rendered the same whether it stands alone or sits in a group —
  // a grouped deduction is an ordinary deduction, receipt and all.
  // A donation sits in its donations group and nowhere else, so it has no grip
  // to drag by.
  const renderPayment = (
    deduction: DeductionRow,
    { onEdit, onDelete: onDeleteItem }: ItemControls,
  ) => {
    const Item = deduction.category === 'donation' ? DeductionItem : DraggableDeduction
    return (
      <Item
        deduction={deduction}
        receipt={receiptFor(deduction)}
        onEdit={onEdit}
        onDelete={onDeleteItem}
        signedUrl={signedUrl}
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{member.name}</Text>
          <Text fw={600} size="sm">
            {formatCents(totalCents)}
          </Text>
        </Group>

        <DeductionReceiptImport
          member={member}
          attachments={attachments}
          financialYear={financialYear}
          groups={groups}
          onCreate={onCreate}
        />

        <EditableList<DeductionGroupRow, DeductionGroupInput>
          items={groups}
          addLabel="Add group"
          emptyMessage=""
          deleteTarget={(group) => ({
            title: 'Delete group?',
            itemLabel: group.name,
          })}
          onCreate={onCreateGroup}
          onUpdate={onUpdateGroup}
          onDelete={onDeleteGroup}
          renderItem={(group, { onEdit, onDelete: onDeleteItem }) => (
            <DropTarget
              id={groupDropId(group.id)}
              valid={isValidTarget(groupDropId(group.id))}
              dragging={dragging !== undefined}
            >
              <DeductionGroup
                group={group}
                payments={deductions.filter((deduction) => deduction.group_id === group.id)}
                onEdit={onEdit}
                onDelete={onDeleteItem}
              >
                {/* The group's own payments list: adding here files the payment
                into the group, and editing or deleting one is the same
                operation it is on a standalone deduction. */}
                <EditableList<DeductionRow, DeductionSubmission>
                  items={deductions.filter((deduction) => deduction.group_id === group.id)}
                  addLabel="Add payment"
                  emptyMessage="No payments yet."
                  deleteTarget={(deduction) => ({
                    title: 'Delete payment?',
                    itemLabel: deduction.description,
                  })}
                  onCreate={onCreate}
                  onUpdate={(id, submission) => onUpdate(id, submission.input)}
                  onDelete={onDelete}
                  renderItem={(deduction, controls) => renderPayment(deduction, controls)}
                  renderForm={({ initial, onSubmit, onCancel }) => (
                    <DeductionForm
                      member={member}
                      attachments={attachments}
                      financialYear={financialYear}
                      // Adding here is adding to THIS group, so it is settled and
                      // no picker is offered. Editing a payment already in it is
                      // where the picker earns its place: that is how one moves to
                      // another group, or out of them all.
                      groups={groups}
                      {...(!initial && { groupId: group.id })}
                      initial={initial}
                      {...(initial && receiptControls(initial))}
                      onSubmit={onSubmit}
                      onCancel={onCancel}
                    />
                  )}
                />
              </DeductionGroup>
            </DropTarget>
          )}
          renderForm={({ initial, onSubmit, onCancel }) => (
            <DeductionGroupForm
              member={member}
              initial={initial}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          )}
        />

        {moveError && (
          <Text size="sm" c="red" role="alert">
            {moveError}
          </Text>
        )}

        <DropTarget
          id={UNGROUPED_DROP_ID}
          valid={isValidTarget(UNGROUPED_DROP_ID)}
          dragging={dragging !== undefined}
        >
          <EditableList<DeductionRow, DeductionSubmission>
            items={ungrouped}
            addLabel="Add deduction"
            emptyMessage="No deductions yet."
            deleteTarget={(deduction) => ({
              title: 'Delete deduction?',
              itemLabel: deduction.description,
            })}
            onCreate={onCreate}
            // Editing goes straight to a plain field update — the RPC that writes
            // the receipt alongside a new deduction is never reached here, so the
            // receipt already on this deduction (managed from its edit form) is
            // never replaced by the empty one an edit form's submission carries.
            onUpdate={(id, submission) => onUpdate(id, submission.input)}
            onDelete={onDelete}
            renderItem={(deduction, controls) => renderPayment(deduction, controls)}
            renderForm={({ initial, onSubmit, onCancel }) => (
              <DeductionForm
                member={member}
                attachments={attachments}
                financialYear={financialYear}
                groups={groups}
                initial={initial}
                {...(initial && receiptControls(initial))}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            )}
          />
        </DropTarget>

        <DragOverlay>
          {dragging && (
            <AppCard withBorder padding="xs">
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text fw={600} size="sm" truncate>
                  {dragging.description}
                </Text>
                <MoneyText cents={dragging.amount_cents} fw={700} size="sm" />
              </Group>
            </AppCard>
          )}
        </DragOverlay>

        {modal}
      </Stack>
    </DndContext>
  )
}

/**
 * Presentational deductions manager: one grouped list per household member, each
 * deduction showing its amount and date with its stored receipt, an upload
 * affordance, and a running per-member total. Persistence lives in the caller.
 */
export function DeductionsScreen({
  members,
  deductions,
  groups,
  receipts,
  financialYear,
  availableFinancialYears,
  onFinancialYearChange,
  attachments,
  onCreate,
  onUpdate,
  onDelete,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onUploadReceipt,
  onRemoveReceipt,
  signedUrl,
}: DeductionsScreenProps) {
  return (
    <PageSection
      title={`Tax deductions (FY${financialYear})`}
      intro="Each member’s deductible expenses for the financial year, with a receipt stored privately — pick the receipt before saving a new deduction and its details are read for you to check. A member’s deductions reduce their taxable income on the Tax tab, lowering their estimated tax and lifting take-home on the Summary."
    >
      <FinancialYearSelect
        financialYear={financialYear}
        availableFinancialYears={availableFinancialYears}
        onChange={onFinancialYearChange}
      />

      {members.map((member) => (
        <MemberDeductions
          key={member.id}
          member={member}
          deductions={deductions.filter((deduction) => deduction.member_id === member.id)}
          groups={groups.filter((group) => group.member_id === member.id)}
          receipts={receipts}
          attachments={attachments}
          financialYear={financialYear}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onCreateGroup={onCreateGroup}
          onUpdateGroup={onUpdateGroup}
          onDeleteGroup={onDeleteGroup}
          onUploadReceipt={onUploadReceipt}
          onRemoveReceipt={onRemoveReceipt}
          signedUrl={signedUrl}
        />
      ))}
    </PageSection>
  )
}
