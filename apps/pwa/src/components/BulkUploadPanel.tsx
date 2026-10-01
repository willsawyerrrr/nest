import { useRef, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Progress,
  Stack,
  Text,
} from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import {
  DRAFT_STATUSES,
  type QueueItem,
  type QueueStatus,
  type UploadQueue,
} from '../hooks/useUploadQueue'
import { batchLimitMessage } from '../lib/bulkUpload'

/** How a draft's form reports back to the queue it was opened from. */
export interface DraftControls {
  /**
   * Runs the save, and on success records that the stored file is now referenced.
   * `completes` (the default) also ends the file's review as saved; a file that
   * holds several drafts passes false and calls {@link DraftControls.finish}
   * once the last is resolved.
   */
  save: (run: () => Promise<void>, completes?: boolean) => Promise<void>
  /** Ends the file's review: saved leaves a saved row, otherwise the file is removed. */
  finish: (saved: boolean) => void
  /** Drops the draft and deletes the stored file. */
  discard: () => void
  /** Whether the last save-selected run left this file needing the member's attention. */
  attention: boolean
}

interface BulkUploadPanelProps<T, M> {
  queue: UploadQueue<T, M>
  /** The form for one file's draft. */
  renderDraft: (item: QueueItem<T, M>, controls: DraftControls) => ReactNode
}

const STATUS_BADGES: Record<QueueStatus, { label: string; color: string }> = {
  queued: { label: 'Queued', color: 'gray' },
  reading: { label: 'Reading', color: 'blue' },
  ready: { label: 'Ready', color: 'teal' },
  unsupported: { label: 'Unsupported type', color: 'yellow' },
  manual: { label: 'Enter by hand', color: 'yellow' },
  failed: { label: "Couldn't be read", color: 'red' },
  saved: { label: 'Saved', color: 'green' },
}

/** One file's row: its name and status, and what the member can do about a failure. */
function ItemHeader<T, M>({
  item,
  queue,
  selected,
  onSelect,
}: {
  item: QueueItem<T, M>
  queue: UploadQueue<T, M>
  selected: boolean
  onSelect: (selected: boolean) => void
}) {
  const badge = STATUS_BADGES[item.status]
  const draft = DRAFT_STATUSES.includes(item.status)
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          {draft && (
            <Checkbox
              size="xs"
              aria-label={`Select ${item.file.name}`}
              checked={selected}
              onChange={(event) => onSelect(event.currentTarget.checked)}
            />
          )}
          <Text size="sm" fw={500} truncate>
            {item.file.name}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {item.status === 'reading' && <Loader size={12} />}
          <Badge size="sm" color={badge.color} variant="light">
            {badge.label}
          </Badge>
          {(item.status === 'queued' || item.status === 'failed') && (
            <ActionIcon
              variant="subtle"
              size="sm"
              color="gray"
              aria-label={`Remove ${item.file.name}`}
              onClick={() => queue.remove(item.id)}
            >
              <IconX size={14} />
            </ActionIcon>
          )}
        </Group>
      </Group>
      {item.status === 'failed' && (
        <>
          <Text size="xs" c="dimmed">
            {item.message}
          </Text>
          <Group gap="xs">
            {item.retryable && (
              <Button
                size="compact-xs"
                variant="default"
                aria-label={`Try ${item.file.name} again`}
                onClick={() => queue.retry(item.id)}
              >
                Try again
              </Button>
            )}
            {item.path !== null && (
              <Button
                size="compact-xs"
                variant="default"
                aria-label={`Enter ${item.file.name} by hand`}
                onClick={() => queue.enterByHand(item.id)}
              >
                Enter by hand
              </Button>
            )}
          </Group>
        </>
      )}
      {(item.status === 'unsupported' || item.status === 'manual') && (
        <Text size="xs" c="dimmed">
          {item.message}
        </Text>
      )}
    </Stack>
  )
}

/**
 * The review surface for a bulk upload: one card per file the queue holds, with its
 * status and — once read — the surface's own form for the draft. It renders
 * nothing until the queue has a file; files reach the queue from the add card's
 * file input, which hands several at once to `queue.add`.
 * Each draft is confirmed, edited, or discarded on its own; **Save selected**
 * submits every selected draft's own form in turn, so a draft that is not valid
 * yet is reported rather than saved, and one that fails does not stop the rest.
 * Closing the panel deletes the stored files of drafts that were not saved.
 */
export function BulkUploadPanel<T, M>({ queue, renderDraft }: BulkUploadPanelProps<T, M>) {
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [attention, setAttention] = useState<ReadonlySet<string>>(new Set())
  const container = useRef<HTMLDivElement>(null)
  // The saves each file's forms have started during a Save selected run.
  const submissions = useRef(new Map<string, Promise<void>[]>())

  const drafts = queue.items.filter((item) => DRAFT_STATUSES.includes(item.status))
  const selected = drafts.filter((item) => !deselected.has(item.id))
  const saving = progress !== null
  const unsaved = queue.items.some((item) => item.status !== 'saved')

  const toggle = (id: string, on: boolean) =>
    setDeselected((current) => {
      const next = new Set(current)
      if (on) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const saveSelected = async () => {
    const targets = [...selected]
    setSummary(null)
    setAttention(new Set())
    setProgress({ done: 0, total: targets.length })
    const needAttention = new Set<string>()
    let saved = 0
    for (const [index, item] of targets.entries()) {
      const forms = container.current!.querySelectorAll<HTMLFormElement>(
        `[data-draft="${item.id}"] form`,
      )
      const started: Promise<void>[] = []
      submissions.current.set(item.id, started)
      // Each form validates itself: one that is not valid never starts a save.
      forms.forEach((form) => form.requestSubmit())
      const results = await Promise.allSettled(started)
      saved += results.filter((result) => result.status === 'fulfilled').length
      if (started.length < forms.length || results.some((result) => result.status === 'rejected')) {
        needAttention.add(item.id)
      }
      setProgress({ done: index + 1, total: targets.length })
    }
    submissions.current.clear()
    setProgress(null)
    setAttention(needAttention)
    const left = needAttention.size
    setSummary(
      `Saved ${saved}.${left > 0 ? ` ${left === 1 ? '1 file needs' : `${left} files need`} another look: check the details marked below, then save again.` : ''}`,
    )
  }

  if (queue.items.length === 0) {
    return null
  }

  return (
    <Stack gap="xs" ref={container}>
      {queue.skipped > 0 && (
        <Alert color="yellow" variant="light" p="xs">
          <Text size="xs">{batchLimitMessage(queue.skipped)}</Text>
        </Alert>
      )}
      {queue.halted !== null && (
        <Alert color="yellow" variant="light" p="xs" title="Reading has stopped">
          <Text size="xs">{queue.halted}</Text>
        </Alert>
      )}

      {queue.items.map((item) => (
        <Card
          key={item.id}
          withBorder
          p="xs"
          radius="md"
          aria-label={item.file.name}
          data-draft={item.id}
        >
          <Stack gap="xs">
            <ItemHeader
              item={item}
              queue={queue}
              selected={!deselected.has(item.id)}
              onSelect={(on) => toggle(item.id, on)}
            />
            {attention.has(item.id) && (
              <Text size="xs" c="red" role="alert">
                This one still needs a look.
              </Text>
            )}
            {DRAFT_STATUSES.includes(item.status) &&
              renderDraft(item, {
                attention: attention.has(item.id),
                discard: () => queue.finish(item.id, false),
                finish: (saved) => queue.finish(item.id, saved),
                save: async (run, completes = true) => {
                  const started = run().then(() => {
                    queue.keep(item.id)
                    if (completes) {
                      queue.finish(item.id, true)
                    }
                  })
                  submissions.current.get(item.id)?.push(started)
                  await started
                },
              })}
          </Stack>
        </Card>
      ))}

      {drafts.length > 0 && (
        <Stack gap="xs">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Checkbox
              size="xs"
              label="Select all"
              checked={selected.length === drafts.length}
              indeterminate={selected.length > 0 && selected.length < drafts.length}
              onChange={(event) =>
                setDeselected(
                  event.currentTarget.checked ? new Set() : new Set(drafts.map((d) => d.id)),
                )
              }
            />
            <Button
              size="xs"
              disabled={selected.length === 0 || saving}
              onClick={() => void saveSelected()}
            >
              {saving ? 'Saving…' : `Save selected (${selected.length})`}
            </Button>
          </Group>
          {progress !== null && (
            <Stack gap={4} role="status">
              <Progress value={(progress.done / progress.total) * 100} size="sm" />
              <Text size="xs" c="dimmed">
                Saved {progress.done} of {progress.total}
              </Text>
            </Stack>
          )}
        </Stack>
      )}

      {summary !== null && (
        <Text size="sm" role="status">
          {summary}
        </Text>
      )}

      {queue.items.length > 0 && (
        <Button
          size="xs"
          variant="default"
          disabled={saving}
          onClick={() => {
            queue.clear()
            setSummary(null)
            setAttention(new Set())
            setDeselected(new Set())
          }}
        >
          {unsaved ? 'Discard all' : 'Done'}
        </Button>
      )}
    </Stack>
  )
}
