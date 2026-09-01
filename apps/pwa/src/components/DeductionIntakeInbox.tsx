import { useState } from 'react'
import { Alert, Modal, Text } from '@mantine/core'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionSubmission } from '../hooks/useDeductions'
import type { DocumentIntakeRow } from '../hooks/useDocumentIntake'
import type { Member } from '../hooks/useMembers'
import { DeductionForm } from './DeductionForm'
import { DocumentIntakeInbox } from './DocumentIntakeInbox'

export interface DeductionIntakeInboxProps {
  members: Member[]
  groups: DeductionGroupRow[]
  attachments: DeductionAttachments
  financialYear: number
  documentIntake: {
    items: readonly DocumentIntakeRow[]
    download: (item: DocumentIntakeRow) => Promise<File>
    clear: (item: DocumentIntakeRow) => Promise<void>
  }
  onCreate: (submission: DeductionSubmission) => Promise<void>
}

/**
 * The intake inbox and its review flow: downloading a staged file and opening
 * it in the ordinary add-deduction form, exactly as picking it as a receipt by
 * hand would. `DeductionForm`'s own upload copies the file into the
 * `receipts` bucket under the new deduction's id, so the staged copy is
 * redundant the moment a review is saved — `documentIntake.clear` drops it
 * then, or immediately on Dismiss without ever opening the form. Cancelling
 * the review modal leaves the staged item exactly as it was, for another look
 * later. The member's existing groups for the year are offered, exactly as
 * the ordinary add form offers them.
 */
export function DeductionIntakeInbox({
  members,
  groups,
  attachments,
  financialYear,
  documentIntake,
  onCreate,
}: DeductionIntakeInboxProps) {
  const items = documentIntake.items.filter((item) => item.kind === 'deduction')
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
        title="Review deduction"
        size="lg"
      >
        {reviewing && reviewingMember && (
          <DeductionForm
            member={reviewingMember}
            attachments={attachments}
            financialYear={financialYear}
            groups={groups.filter((group) => group.member_id === reviewingMember.id)}
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
