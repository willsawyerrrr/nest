import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Card,
  FileInput,
  Group,
  Loader,
  Stack,
  Text,
} from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import type { Member } from '../hooks/useMembers'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import { useTradeUploadQueue, type TradeDocumentActions } from '../hooks/useTradeUploadQueue'
import type { QueueItem, UploadQueue } from '../hooks/useUploadQueue'
import type { ExtractedTrade } from '../lib/tradeExtraction'
import { FileDropArea } from './FileDropArea'
import { CheckNotice, TradeDocumentReview } from './TradeDocumentDrafts'
import { TradeForm } from './TradeForm'

interface TradeAddCardProps {
  member: Member
  /** The household's trades, checked for a likely repeat of what is being entered. */
  trades: TradeRow[]
  actions: TradeDocumentActions
  /** Saves a trade entered without a document. */
  onSubmit: (input: TradeInput) => Promise<void>
  onCancel: () => void
}

type Item = QueueItem<ExtractedTrade[], undefined>

/**
 * Where reading the attached contract note has got to, shown under the picker.
 * Every outcome reads as what it is — the feature switched off, a type that
 * cannot be read, a failed read — and none blocks the save: the details are
 * typed by hand exactly as they always were.
 */
function ReadNote({ item, halted }: { item: Item; halted: string | null }) {
  if (item.status === 'queued' || item.status === 'reading') {
    return (
      <Group gap="xs" role="status">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">
          {item.path === null ? 'Storing the contract note…' : 'Reading the contract note…'}
        </Text>
      </Group>
    )
  }
  if (item.status === 'unsupported' || (item.status === 'failed' && halted !== null)) {
    return (
      <Text size="xs" c="dimmed">
        {item.message}
      </Text>
    )
  }
  if (item.status === 'failed') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">{item.message}</Text>
      </Alert>
    )
  }
  return null
}

/** What a successful read did, in one line. */
function ReadFromNote({ filledNothing }: { filledNothing: boolean }) {
  return (
    <Alert color="info" variant="light" p="xs" title="Read from the contract note">
      <Text size="xs">
        {filledNothing
          ? 'Nothing on the contract note could be filled in for you.'
          : 'The details below were extracted from the contract note by AI — check them against it before saving.'}
      </Text>
    </Alert>
  )
}

/** The picker, its status, and the attached file's remove control. */
function Attachment({
  queue,
  item,
  onPick,
  onManual,
}: {
  queue: UploadQueue<ExtractedTrade[], undefined>
  item: Item | undefined
  onPick: (files: File[]) => void
  /** Reveals the fields to type; offered only while they are hidden. */
  onManual: (() => void) | undefined
}) {
  const busy = item?.status === 'queued' || item?.status === 'reading'
  return (
    <Stack gap={6}>
      <FileInput
        size="sm"
        label="Contract notes"
        description={
          onManual
            ? "Add a contract note or several, or drop them here. We'll read the details for you to check — no typing needed. Any file, up to 25 MB."
            : "Any file, up to 25 MB. Stored privately, then read to pre-fill the details below where it can be — which you confirm. Pick again to replace it. Choose or drop several to review each document's trades."
        }
        placeholder="Attach a contract note or several"
        disabled={busy}
        multiple
        value={[]}
        onChange={onPick}
      />
      {item && <ReadNote item={item} halted={queue.halted} />}
      {onManual && (
        <Anchor
          component="button"
          type="button"
          size="xs"
          ta="left"
          disabled={busy}
          onClick={onManual}
        >
          Enter details manually
        </Anchor>
      )}
      {item?.path != null && (
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <Text size="xs">Contract note attached</Text>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            aria-label="Remove contract note"
            onClick={() => queue.remove(item.id)}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      )}
    </Stack>
  )
}

/**
 * The Add trade card. It opens on the contract-note prompt alone; the trade's fields
 * appear when the member chooses to enter details manually, or once a note has been
 * read or could not be, and stay once shown. A contract note, trade confirmation, or statement can be
 * attached as the first step: it is stored, read through `trade-extract`, and
 * its trade opens in the form for the member to check and save, kept attached to
 * the saved trade. A document the model cannot read stays attached with a note,
 * and the trade is typed by hand. Several files, or one document holding several
 * trades, open each trade as its own draft in the bulk upload's review in place
 * of the form; the member saves, edits, or discards each, and Close ends the card.
 * Picking another file replaces the first, and a file the member removes or
 * replaces, or leaves when the card is cancelled, is deleted again unless a saved
 * trade references it.
 */
export function TradeAddCard({ member, trades, actions, onSubmit, onCancel }: TradeAddCardProps) {
  const queue = useTradeUploadQueue(actions)
  // Minted once, so a retried save of the card's trade does not duplicate it.
  const [tradeId] = useState(() => crypto.randomUUID())
  const item = queue.items[0]

  const pick = (files: File[]) => {
    if (item) {
      queue.remove(item.id)
    }
    queue.add(files, undefined)
  }

  const read = item?.status === 'ready' ? item.value! : []
  // The card opens on the contract-note prompt alone. The fields appear when the
  // member chooses to type, or once a note has been stored and read (or could
  // not be), and stay once shown so removing the note never hides them.
  const [revealed, setRevealed] = useState(false)
  const settled = item !== undefined && item.status !== 'queued' && item.status !== 'reading'
  if (settled && !revealed) {
    setRevealed(true)
  }

  if (queue.items.length > 1 || read.length > 1) {
    return (
      <Card withBorder radius="md" p="sm">
        <Stack gap="xs">
          <TradeDocumentReview queue={queue} member={member} trades={trades} actions={actions} />
          <Button variant="default" size="xs" onClick={onCancel}>
            Close
          </Button>
        </Stack>
      </Card>
    )
  }

  const single = read[0]
  const attached = item?.path != null
  return (
    <TradeForm
      key={single ? item!.id : 'blank'}
      member={member}
      initial={single?.values}
      trades={trades}
      busy={item?.status === 'queued' || item?.status === 'reading'}
      showFields={revealed}
      attachment={
        <Stack gap="xs">
          <FileDropArea onFiles={pick}>
            <Attachment
              queue={queue}
              item={item}
              onPick={pick}
              onManual={revealed ? undefined : () => setRevealed(true)}
            />
          </FileDropArea>
          {item?.status === 'ready' && (
            <ReadFromNote filledNothing={!single || Object.keys(single.values).length === 0} />
          )}
        </Stack>
      }
      notice={single && <CheckNotice check={single.check} />}
      onSubmit={async (input) => {
        if (!attached) {
          return onSubmit(input)
        }
        await actions.save({ documentId: item.id, path: item.path!, id: tradeId, input })
        queue.keep(item.id)
        onCancel()
      }}
      onCancel={onCancel}
    />
  )
}
