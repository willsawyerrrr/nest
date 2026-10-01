import { useEffect, useRef, useState } from 'react'
import { Alert, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { UseTradeDocumentsResult } from '../hooks/useTradeDocuments'
import type { TradeRow } from '../hooks/useTrades'
import { useUploadQueue } from '../hooks/useUploadQueue'
import {
  EXTRACTION_UNSUPPORTED_MESSAGE,
  toReadResult,
  type ExtractedTrade,
} from '../lib/tradeExtraction'
import { BulkUploadPanel, type DraftControls } from './BulkUploadPanel'
import { TradeForm } from './TradeForm'

interface TradeDocumentImportProps {
  member: Member
  /** The household's trades, checked for repeats of what the documents list. */
  trades: TradeRow[]
  actions: Pick<UseTradeDocumentsResult, 'upload' | 'discard' | 'extract' | 'save'>
}

/** A trade read from a document, held until the member saves or discards it. */
interface Draft extends ExtractedTrade {
  /** Minted per draft, so a retried save of it does not duplicate the trade. */
  id: string
}

/** What a draft says about the fields the document left for the member. */
function checkNotice(check: string[]) {
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
function DocumentDrafts({
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
  actions: TradeDocumentImportProps['actions']
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
          notice={checkNotice(draft.check)}
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

/**
 * Reads broker contract notes, trade confirmations, and statements — any number
 * at once — and offers each trade on each as a draft form. Every document is
 * stored, then read; every draft is the member's to save, edit, or discard, and
 * nothing is written until they save it. A document with no saved trade is
 * deleted again when its drafts are discarded or the panel is closed, so an
 * abandoned or failed read leaves nothing behind.
 */
export function TradeDocumentImport({ member, trades, actions }: TradeDocumentImportProps) {
  const act = useRef(actions)
  act.current = actions

  const queue = useUploadQueue({
    upload: (id, file) => act.current.upload(id, file),
    discard: (path) => act.current.discard(path),
    read: async (path) => toReadResult(await act.current.extract(path)),
    // A document the model cannot read is still attached: one blank trade to fill
    // in by hand.
    blank: (): ExtractedTrade[] => [{ values: {}, check: [] }],
    unsupportedMessage: EXTRACTION_UNSUPPORTED_MESSAGE,
  })

  return (
    <BulkUploadPanel
      queue={queue}
      noun="documents"
      pickerLabel={`Add ${member.name}'s trades from documents`}
      meta={undefined}
      controls={
        <Text size="xs" c="dimmed">
          Add several documents at once; the trades on each are read into drafts to check.
        </Text>
      }
      renderDraft={(item, controls) => (
        <DocumentDrafts
          documentId={item.id}
          path={item.path!}
          read={item.value!}
          extracted={item.status === 'ready'}
          member={member}
          trades={trades}
          actions={actions}
          controls={controls}
        />
      )}
    />
  )
}
