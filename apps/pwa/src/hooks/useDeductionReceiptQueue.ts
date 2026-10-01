import { useRef } from 'react'
import {
  EXTRACTION_UNSUPPORTED_MESSAGE,
  toReadResult,
  type DeductionExtraction,
} from '../lib/deductionExtraction'
import type { DeductionAttachments } from './useDeductionAttachment'
import type { DeductionCategory } from './useDeductions'
import { useUploadQueue, type UploadQueue } from './useUploadQueue'

/**
 * The queue behind adding several receipts at once. Each receipt is stored and
 * read into its own deduction draft, primed for the kind chosen when it was
 * added, which is also the draft's starting category.
 */
export function useDeductionReceiptQueue(
  attachments: DeductionAttachments,
): UploadQueue<DeductionExtraction | null, DeductionCategory> {
  const act = useRef(attachments)
  act.current = attachments

  return useUploadQueue({
    upload: (id, file) => act.current.upload(id, file),
    discard: (path) => act.current.discard(path),
    read: async (path, _file, kind: DeductionCategory) =>
      toReadResult(await act.current.read(path, kind)),
    blank: (): DeductionExtraction | null => null,
    unsupportedMessage: EXTRACTION_UNSUPPORTED_MESSAGE,
  })
}
