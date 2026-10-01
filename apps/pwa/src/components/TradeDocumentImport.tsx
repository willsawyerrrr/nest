import { Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TradeRow } from '../hooks/useTrades'
import { useTradeUploadQueue, type TradeDocumentActions } from '../hooks/useTradeUploadQueue'
import { TradeDocumentReview } from './TradeDocumentDrafts'

interface TradeDocumentImportProps {
  member: Member
  /** The household's trades, checked for repeats of what the documents list. */
  trades: TradeRow[]
  actions: TradeDocumentActions
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
  const queue = useTradeUploadQueue(actions)

  return (
    <TradeDocumentReview
      queue={queue}
      pickerLabel={`Add ${member.name}'s trades from documents`}
      controls={
        <Text size="xs" c="dimmed">
          Add several documents at once; the trades on each are read into drafts to check.
        </Text>
      }
      member={member}
      trades={trades}
      actions={actions}
    />
  )
}
