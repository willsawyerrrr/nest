import { useRef } from 'react'
import {
  EXTRACTION_UNSUPPORTED_MESSAGE,
  toReadResult,
  type PayslipExtraction,
} from '../lib/payslipExtraction'
import type { PayslipAttachments } from './usePayslips'
import { useUploadQueue, type UploadQueue } from './useUploadQueue'

/**
 * The queue behind adding several payslips at once. Each document is stored and
 * read into its own payslip draft.
 */
export function usePayslipQueue(
  attachments: PayslipAttachments,
): UploadQueue<PayslipExtraction | null, undefined> {
  const act = useRef(attachments)
  act.current = attachments

  return useUploadQueue({
    upload: async (id, file) => (await act.current.upload(id, file)).path,
    discard: (path) => act.current.discard(path),
    read: async (path) => toReadResult(await act.current.read(path)),
    blank: (): PayslipExtraction | null => null,
    unsupportedMessage: EXTRACTION_UNSUPPORTED_MESSAGE,
  })
}
