import { useRef } from 'react'
import {
  EXTRACTION_UNSUPPORTED_MESSAGE,
  toReadResult,
  type ExtractedTrade,
} from '../lib/tradeExtraction'
import type { UseTradeDocumentsResult } from './useTradeDocuments'
import { useUploadQueue, type UploadQueue } from './useUploadQueue'

/** What storing, reading, and saving a trade document takes. */
export type TradeDocumentActions = Pick<
  UseTradeDocumentsResult,
  'upload' | 'discard' | 'extract' | 'save'
>

/**
 * The upload queue every trade-document surface shares: each file is stored,
 * then read through `trade-extract` into the trades on it. A file the model
 * cannot read is still kept, with one blank trade to fill in by hand.
 */
export function useTradeUploadQueue(
  actions: TradeDocumentActions,
): UploadQueue<ExtractedTrade[], undefined> {
  const act = useRef(actions)
  act.current = actions

  return useUploadQueue<ExtractedTrade[], undefined>({
    upload: (id, file) => act.current.upload(id, file),
    discard: (path) => act.current.discard(path),
    read: async (path) => toReadResult(await act.current.extract(path)),
    blank: () => [{ values: {}, check: [] }],
    unsupportedMessage: EXTRACTION_UNSUPPORTED_MESSAGE,
  })
}
