import { useEffect, useRef, useState } from 'react'
import { Alert, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TradeRow } from '../hooks/useTrades'
import type { TradeDocumentActions } from '../hooks/useTradeUploadQueue'
import type { UploadQueue } from '../hooks/useUploadQueue'
import type { ExtractedTrade } from '../lib/tradeExtraction'
import { BulkUploadPanel, type DraftControls } from './BulkUploadPanel'
import { TradeForm } from './TradeForm'

/** A trade read from a document, held until the member saves or discards it. */
interface Draft extends ExtractedTrade {
  /** Minted per draft, so a retried save of it does not duplicate the trade. */
  id: string
}

/** What a draft says about the fields the document left for the member. */
export function CheckNotice({ check }: { check: string[] }) {
  if (check.length === 0) {
    return null
  }
  return (
    <Alert color="yellow" variant="light" p="xs">
      Check the {check.join(', ')}: the document did not give {check.length === 1 ? 'it' : 'them'}{' '}
      clearly.
    </Alert>
  )
}

/**
 * The drafts of one document: a form for each trade read from it, or one blank
 * form for a document nothing could be read from. The document's review ends when
 * every draft is saved or discarded — saved if any trade was, otherwise the
 * document is deleted again.
 */
export function DocumentDrafts({
  documentId,
  path,
  read,
  extracted,
  member,
  trades,
  actions,
  controls,
}: {
  documentId: string
  path: string
  read: ExtractedTrade[]
  /** Whether the trades were read from the document, rather than a blank one for hand entry. */
  extracted: boolean
  member: Member
  trades: TradeRow[]
  actions: TradeDocumentActions
  controls: DraftControls
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    read.map((trade) => ({ ...trade, id: crypto.randomUUID() })),
  )
  const saved = useRef(false)
  const finish = useRef(controls.finish)
  finish.current = controls.finish

  const resolve = (id: string) => setDrafts((current) => current.filter((draft) => draft.id !== id))

  const resolved = drafts.length === 0
  useEffect(() => {
    if (resolved) {
      finish.current(saved.current)
    }
  }, [resolved])

  return (
    <>
      {extracted && (
        <Text size="xs" c="dimmed">
          {drafts.length === 1 ? '1 trade was' : `${drafts.length} trades were`} extracted by AI —
          check each against the document, then save or discard it.
        </Text>
      )}
      {drafts.map((draft) => (
        <TradeForm
          key={draft.id}
          member={member}
          initial={draft.values}
          trades={trades}
          notice={<CheckNotice check={draft.check} />}
          submitLabel="Save trade"
          cancelLabel="Discard"
          onSubmit={(input) =>
            controls.save(async () => {
              await actions.save({ documentId, path, id: draft.id, input })
              saved.current = true
              resolve(draft.id)
            }, false)
          }
          onCancel={() => resolve(draft.id)}
        />
      ))}
    </>
  )
}

/** The bulk panel for trade documents: each file's trades as draft forms. */
export function TradeDocumentReview({
  queue,
  member,
  trades,
  actions,
}: {
  queue: UploadQueue<ExtractedTrade[], undefined>
  member: Member
  trades: TradeRow[]
  actions: TradeDocumentActions
}) {
  return (
    <BulkUploadPanel
      queue={queue}
      renderDraft={(item, draftControls) => (
        <DocumentDrafts
          documentId={item.id}
          path={item.path!}
          read={item.value!}
          extracted={item.status === 'ready'}
          member={member}
          trades={trades}
          actions={actions}
          controls={draftControls}
        />
      )}
    />
  )
}
