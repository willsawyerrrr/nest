import { Button, Group, Stack, Text } from '@mantine/core'
import type { DocumentIntakeRow } from '../hooks/useDocumentIntake'
import { AppCard } from './AppCard'

/** A day-month, time label for a timestamptz — `document_intake.created_at` is a full instant, not a plain date. */
function formatUploadedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export interface DocumentIntakeInboxProps {
  /** Already filtered to the one kind this tab reviews. */
  items: readonly DocumentIntakeRow[]
  memberName: (memberId: string) => string
  /** The item currently being downloaded or dismissed, so its own row shows a spinner rather than the whole list. */
  busyId: string | null
  onReview: (item: DocumentIntakeRow) => void
  onDismiss: (item: DocumentIntakeRow) => void
}

/**
 * Files an iOS Shortcut posted from outside the PWA (see
 * [`docs/document-intake.md`](../../../docs/document-intake.md)), staged and
 * waiting for a member to look at them. Nothing here is a payslip or a
 * deduction yet: Review opens the ordinary add form pre-filled from the file,
 * exactly as picking it by hand would, and only the member's own save turns
 * it into one. Dismiss discards the file without creating anything. Renders
 * nothing when there is nothing staged.
 */
export function DocumentIntakeInbox({
  items,
  memberName,
  busyId,
  onReview,
  onDismiss,
}: DocumentIntakeInboxProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <AppCard withBorder padding="xs">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Shared to Nest
        </Text>
        <Text size="xs" c="dimmed">
          Sent in from a Shortcut, waiting to be reviewed. Nothing is saved until you confirm it
          below.
        </Text>
        {items.map((item) => (
          <Group key={item.id} justify="space-between" wrap="nowrap" gap="xs">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} truncate>
                {item.original_filename ?? 'Untitled document'}
              </Text>
              <Text size="xs" c="dimmed">
                {memberName(item.member_id)} · {formatUploadedAt(item.created_at)}
              </Text>
            </Stack>
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
              <Button
                size="xs"
                variant="light"
                loading={busyId === item.id}
                onClick={() => onReview(item)}
              >
                Review
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                disabled={busyId === item.id}
                onClick={() => onDismiss(item)}
              >
                Dismiss
              </Button>
            </Group>
          </Group>
        ))}
      </Stack>
    </AppCard>
  )
}
