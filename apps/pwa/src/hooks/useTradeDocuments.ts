import { useCallback } from 'react'
import { financialYearForDate } from '@nest/tax'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import {
  EXTRACTION_FAILED_MESSAGE,
  readExtraction,
  readExtractionFailure,
  type ExtractionOutcome,
} from '../lib/tradeExtraction'
import { signedUrlOptions, storageKeyName, storedContentType } from '../lib/uploadFile'
import { useHouseholdCollection } from './useCollection'
import type { TradeInput } from './useTrades'

export type TradeDocumentRow = Tables<'trade_document'>

/** The private Storage bucket documents live in, shared with deduction receipts. */
const DOCUMENTS_BUCKET = 'receipts'

/** How long a document's signed URL stays valid, in seconds (one hour). */
const SIGNED_URL_TTL_SECONDS = 3600

/** One confirmed trade to save, with the document it was read from. */
export interface TradeFromDocument {
  /** The id minted for the document when it was picked. */
  documentId: string
  /** Where the document was uploaded. */
  path: string
  /** The id minted for the draft, so a retried save does not duplicate it. */
  id: string
  input: TradeInput
}

export interface UseTradeDocumentsResult {
  documents: TradeDocumentRow[] | null
  /**
   * Uploads `file` under `documentId` in Storage without a `trade_document` row,
   * which is written with the first trade confirmed from it. Resolves to the
   * object's path.
   */
  upload: (documentId: string, file: File) => Promise<string>
  /** Deletes an uploaded object no trade references. Best effort: a failure is swallowed. */
  discard: (path: string) => Promise<void>
  /**
   * Reads an uploaded document through `trade-extract`. `financialYear` (the
   * current one) is sent so a yearless date resolves within it.
   */
  extract: (path: string) => Promise<ExtractionOutcome>
  /**
   * Saves one confirmed trade and the document it was read from, in one
   * transaction — see `create_trades_with_document`. Saving several trades from
   * one document reuses its row.
   */
  save: (trade: TradeFromDocument) => Promise<void>
  /** A short-lived signed URL for viewing a stored document, or null on failure. */
  signedUrl: (path: string) => Promise<string | null>
}

/**
 * Loads the household's trade documents and runs the import flow. Files sit in
 * the private `receipts` bucket, laid out as `<household_id>/<document_id>/<uuid>-<file>`
 * so the first path segment gates access to the owning household, exactly as
 * deduction receipts are.
 */
export function useTradeDocuments(
  financialYear: number = financialYearForDate(new Date()),
): UseTradeDocumentsResult {
  const householdId = useHouseholdId()
  const { rows, reload } = useHouseholdCollection<'trade_document', never>({
    table: 'trade_document',
    orderBy: 'created_at',
    // create_trades_with_document writes the trades alongside their document.
    alsoInvalidate: ['trade'],
  })

  const upload = useCallback(
    async (documentId: string, file: File): Promise<string> => {
      const path = `${householdId}/${documentId}/${crypto.randomUUID()}-${storageKeyName(file.name)}`
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
        contentType: storedContentType(file.name),
      })
      if (error) {
        throw error
      }
      return path
    },
    [householdId],
  )

  const discard = useCallback(async (path: string) => {
    try {
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
      if (error) {
        throw error
      }
    } catch {
      // An object nobody references is litter, not a failure the member can act on.
    }
  }, [])

  const extract = useCallback(
    async (path: string): Promise<ExtractionOutcome> => {
      const { data, error, response } = await supabase.functions.invoke<unknown>('trade-extract', {
        body: { path, financialYear },
      })
      if (error) {
        // A non-2xx carries the function's own code and message as JSON; a
        // transport failure carries no response at all.
        const body = response ? await response.json().catch(() => null) : null
        return readExtractionFailure(body)
      }
      const trades = readExtraction(data)
      return trades === null
        ? { status: 'failed', message: EXTRACTION_FAILED_MESSAGE }
        : { status: 'read', trades }
    },
    [financialYear],
  )

  const save = useCallback(
    async ({ documentId, path, id, input }: TradeFromDocument) => {
      const { error } = await supabase.rpc('create_trades_with_document', {
        p_household_id: householdId,
        p_document_id: documentId,
        p_document_path: path,
        p_trades: [{ ...input, id }],
      })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const signedUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, signedUrlOptions(path))
    return error ? null : data.signedUrl
  }, [])

  return { documents: rows, upload, discard, extract, save, signedUrl }
}
