import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeductionExtraction, ExtractionFailure } from '../lib/deductionExtraction'
import {
  UPLOAD_FAILED_MESSAGE,
  useDeductionAttachment,
  type DeductionAttachments,
} from './useDeductionAttachment'
import type { PrefillSummary } from './useDeductionFields'

const extraction: DeductionExtraction = {
  model: 'claude-haiku-4-5-20251001',
  fields: { description: 'Officeworks', amount_cents: 124_50 },
}

const summary: PrefillSummary = { filledNothing: false }

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()
const attachments: DeductionAttachments = { upload, discard, read }
const onExtracted = vi.fn<(value: DeductionExtraction) => PrefillSummary>()

function receipt(name = 'receipt.pdf') {
  return new File(['x'], name, { type: 'application/pdf' })
}

function renderAttachment(
  category: 'work_expense' | 'donation' | 'tax_agent_fees' = 'work_expense',
) {
  return renderHook(() => useDeductionAttachment({ attachments, category, onExtracted }))
}

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(
    async (deductionId: string, file: File) => `h1/${deductionId}/uuid-${file.name}`,
  )
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({ status: 'read', extraction })
  onExtracted.mockReturnValue(summary)
})

describe('useDeductionAttachment', () => {
  it('stores a receipt, reads it, and pre-fills from what it read', async () => {
    const { result } = renderAttachment()
    const file = receipt()

    let pending!: Promise<void>
    act(() => {
      pending = result.current.addFile(file)
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => await pending)

    const [deductionId, uploaded] = upload.mock.calls[0]!
    expect(deductionId).toBe(result.current.deductionId)
    expect(uploaded).toBe(file)
    expect(read).toHaveBeenCalledWith(`h1/${deductionId}/uuid-receipt.pdf`, 'work_expense')
    expect(onExtracted).toHaveBeenCalledWith(extraction)
    expect(result.current.state).toEqual({ status: 'read', ...summary })
    expect(result.current.path).toBe(`h1/${deductionId}/uuid-receipt.pdf`)
    expect(result.current.busy).toBe(false)
  })

  it('primes the read with the category passed to the hook', async () => {
    const { result } = renderAttachment('donation')

    await act(async () => await result.current.addFile(receipt()))

    expect(read).toHaveBeenCalledWith(expect.any(String), 'donation')
  })

  it('mints one id for the form, so a replacement lands under the same prefix', async () => {
    const { result } = renderAttachment()

    await act(async () => await result.current.addFile(receipt('first.pdf')))
    const id = result.current.deductionId
    await act(async () => await result.current.addFile(receipt('second.pdf')))

    expect(upload.mock.calls[0]![0]).toBe(id)
    expect(upload.mock.calls[1]![0]).toBe(id)
  })

  it('replaces the attached file: deletes the old object and reads the new one', async () => {
    const { result } = renderAttachment()

    await act(async () => await result.current.addFile(receipt('first.pdf')))
    const id = result.current.deductionId
    await act(async () => await result.current.addFile(receipt('second.pdf')))

    expect(discard).toHaveBeenCalledWith(`h1/${id}/uuid-first.pdf`)
    expect(discard).toHaveBeenCalledTimes(1)
    expect(result.current.path).toBe(`h1/${id}/uuid-second.pdf`)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('removes the uploaded file, discarding its stored object', async () => {
    const { result } = renderAttachment()

    await act(async () => await result.current.addFile(receipt()))
    const path = result.current.path!
    await act(async () => await result.current.removeFile())

    expect(discard).toHaveBeenCalledWith(path)
    expect(result.current.path).toBeNull()
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('deletes the file the member walked away from', async () => {
    const { result, unmount } = renderAttachment()

    await act(async () => await result.current.addFile(receipt()))
    const path = result.current.path
    unmount()

    expect(discard).toHaveBeenCalledWith(path)
  })

  it('leaves the uploaded file alone once the row that references it is written', async () => {
    const { result, unmount } = renderAttachment()

    await act(async () => await result.current.addFile(receipt()))
    act(() => result.current.keep())
    unmount()

    expect(discard).not.toHaveBeenCalled()
  })

  it('deletes an upload that lands after the form has gone', async () => {
    let finishUpload!: (stored: string) => void
    upload.mockReturnValue(
      new Promise<string>((resolve) => {
        finishUpload = resolve
      }),
    )
    const { result, unmount } = renderAttachment()

    let pending!: Promise<void>
    act(() => {
      pending = result.current.addFile(receipt())
    })
    // Nothing is stored yet, so unmount cleanup has no path to delete.
    unmount()
    expect(discard).not.toHaveBeenCalled()

    await act(async () => {
      finishUpload('h1/d1/uuid-receipt.pdf')
      await pending
    })

    expect(discard).toHaveBeenCalledWith('h1/d1/uuid-receipt.pdf')
    expect(read).not.toHaveBeenCalled()
  })

  it('pre-fills nothing from a read that lands after the form has gone', async () => {
    let finishRead!: (outcome: { status: 'read'; extraction: DeductionExtraction }) => void
    read.mockReturnValue(
      new Promise<{ status: 'read'; extraction: DeductionExtraction }>((resolve) => {
        finishRead = resolve
      }),
    )
    const { result, unmount } = renderAttachment()

    let pending!: Promise<void>
    act(() => {
      pending = result.current.addFile(receipt())
    })
    await waitFor(() => expect(read).toHaveBeenCalled())
    const path = result.current.path
    unmount()

    await act(async () => {
      finishRead({ status: 'read', extraction })
      await pending
    })

    expect(onExtracted).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledWith(path)
  })

  it('deletes nothing when no file was ever attached', () => {
    const { unmount } = renderAttachment()
    unmount()
    expect(discard).not.toHaveBeenCalled()
  })

  it('reports a failed upload and attaches nothing', async () => {
    upload.mockRejectedValue(new Error('nope'))
    const { result } = renderAttachment()

    await act(async () => await result.current.addFile(receipt()))

    expect(result.current.state).toEqual({ status: 'failed', message: UPLOAD_FAILED_MESSAGE })
    expect(result.current.path).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('keeps the receipt attached when the read fails, and pre-fills nothing', async () => {
    for (const outcome of [
      { status: 'not-configured', message: 'Not configured.' },
      { status: 'out-of-credit', message: 'Out of credit.' },
      { status: 'key-rejected', message: 'Key refused.' },
      { status: 'not-receipt', message: 'Not a receipt.', reason: 'A bank statement.' },
      { status: 'failed', message: 'Rate limited.' },
    ] satisfies ExtractionFailure[]) {
      read.mockResolvedValue(outcome)
      const { result, unmount } = renderAttachment()

      await act(async () => await result.current.addFile(receipt()))

      expect(result.current.state).toEqual(outcome)
      expect(result.current.path).not.toBeNull()
      expect(onExtracted).not.toHaveBeenCalled()
      act(() => result.current.keep())
      unmount()
    }
  })
})
