import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { UseTradeDocumentsResult } from '../hooks/useTradeDocuments'
import type { TradeRow } from '../hooks/useTrades'
import type { ExtractedTrade } from '../lib/tradeExtraction'
import { TradeForm } from './TradeForm'

interface TradeDocumentImportProps {
  /** The broker document the member picked. */
  file: File
  member: Member
  /** The household's trades, checked for repeats of what the document lists. */
  trades: TradeRow[]
  actions: Pick<UseTradeDocumentsResult, 'upload' | 'discard' | 'extract' | 'save'>
  onClose: () => void
}

/** A trade read from the document, held until the member saves or discards it. */
interface Draft extends ExtractedTrade {
  /** Minted per draft, so a retried save of it does not duplicate the trade. */
  id: string
}

type Stage =
  | { status: 'reading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; path: string; documentId: string }

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
 * Reads a broker contract note, trade confirmation, or statement and offers each
 * trade on it as a draft form. The document is stored first, then read; every
 * draft is the member's to save, edit, or discard, and nothing is written until
 * they save it. A document with no saved trade is deleted again when the panel
 * closes, so an abandoned or failed read leaves nothing behind.
 */
export function TradeDocumentImport({
  file,
  member,
  trades,
  actions,
  onClose,
}: TradeDocumentImportProps) {
  const [stage, setStage] = useState<Stage>({ status: 'reading' })
  const [drafts, setDrafts] = useState<Draft[]>([])
  const saved = useRef(false)
  const act = useRef(actions)
  act.current = actions

  useEffect(() => {
    let cancelled = false
    let stored: string | null = null
    const documentId = crypto.randomUUID()

    const run = async () => {
      try {
        stored = await act.current.upload(documentId, file)
      } catch {
        if (!cancelled) {
          setStage({
            status: 'failed',
            message: 'Could not upload this document. Try again, or enter the trades by hand.',
          })
        }
        return
      }
      if (cancelled) {
        void act.current.discard(stored)
        return
      }
      const outcome = await act.current.extract(stored)
      if (cancelled) {
        return
      }
      if (outcome.status === 'failed') {
        setStage(outcome)
        return
      }
      setDrafts(outcome.trades.map((trade) => ({ ...trade, id: crypto.randomUUID() })))
      setStage({ status: 'ready', path: stored, documentId })
    }
    void run()

    return () => {
      cancelled = true
      if (stored !== null && !saved.current) {
        void act.current.discard(stored)
      }
    }
  }, [file])

  // The panel closes itself once every draft has been saved or discarded.
  const allResolved = stage.status === 'ready' && drafts.length === 0
  useEffect(() => {
    if (allResolved) {
      onClose()
    }
  }, [allResolved, onClose])

  const resolve = (id: string) => setDrafts((current) => current.filter((draft) => draft.id !== id))

  if (stage.status === 'reading') {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Reading the document…
        </Text>
      </Group>
    )
  }

  if (stage.status === 'failed') {
    return (
      <Alert color="red" variant="light" p="xs" title="Could not read the document">
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{stage.message}</Text>
          <Button size="xs" variant="default" onClick={onClose}>
            Close
          </Button>
        </Stack>
      </Alert>
    )
  }

  return (
    <Stack gap="xs">
      <Alert color="info" variant="light" p="xs" title="Read from the document">
        <Text size="sm">
          {drafts.length === 1 ? '1 trade was' : `${drafts.length} trades were`} extracted by AI —
          check each against the document, then save or discard it.
        </Text>
      </Alert>
      {drafts.map((draft) => (
        <TradeForm
          key={draft.id}
          member={member}
          initial={draft.values}
          trades={trades}
          notice={checkNotice(draft.check)}
          submitLabel="Save trade"
          cancelLabel="Discard"
          onSubmit={async (input) => {
            await actions.save({
              documentId: stage.documentId,
              path: stage.path,
              id: draft.id,
              input,
            })
            saved.current = true
            resolve(draft.id)
          }}
          onCancel={() => resolve(draft.id)}
        />
      ))}
    </Stack>
  )
}
