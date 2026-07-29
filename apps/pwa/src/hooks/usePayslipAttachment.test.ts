import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractionOutcome, PayslipExtraction } from '../lib/payslipExtraction'
import { UPLOAD_FAILED_MESSAGE, usePayslipAttachment } from './usePayslipAttachment'
import type { PrefillSummary } from './usePayslipFields'
import type { PayslipAttachments } from './usePayslips'

const extraction: PayslipExtraction = {
  model: 'claude-haiku-4-5-20251001',
  fields: { gross_cents: 4_120_50 },
  text: { gross: '4,120.50' },
  missing: [],
  unreadable: [],
}

const summary: PrefillSummary = { filled: ['gross_cents'], kept: [] }

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()
const attachments: PayslipAttachments = { upload, discard, read }
const onExtracted = vi.fn<(value: PayslipExtraction) => PrefillSummary>()

function slip(name = 'slip.pdf') {
  return new File(['x'], name, { type: 'application/pdf' })
}

function renderAttachment(payslipId: string | null = null) {
  return renderHook(() => usePayslipAttachment({ attachments, payslipId, onExtracted }))
}

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(async (payslipId: string, file: File) => ({
    payslipId,
    path: `h1/${payslipId}/uuid-${file.name}`,
  }))
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({ status: 'read', extraction } satisfies ExtractionOutcome)
  onExtracted.mockReturnValue(summary)
})

describe('usePayslipAttachment', () => {
  it('stores the slip, reads it, and pre-fills from what it read', async () => {
    const { result } = renderAttachment()
    const file = slip()

    let pending!: Promise<void>
    act(() => {
      pending = result.current.choose(file)
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => await pending)

    const [payslipId, uploaded] = upload.mock.calls[0]!
    expect(uploaded).toBe(file)
    expect(read).toHaveBeenCalledWith(`h1/${payslipId}/uuid-slip.pdf`)
    expect(onExtracted).toHaveBeenCalledWith(extraction)
    expect(result.current.state).toEqual({ status: 'read', extraction, ...summary })
    expect(result.current.attachment).toEqual({
      payslipId,
      path: `h1/${payslipId}/uuid-slip.pdf`,
    })
    expect(result.current.busy).toBe(false)
  })

  it('files a document for an existing payslip under that payslip’s own id', async () => {
    const { result } = renderAttachment('ps1')

    await act(async () => await result.current.choose(slip()))

    expect(upload).toHaveBeenCalledWith('ps1', expect.any(File))
  })

  it('mints one id for the form, so a replaced document lands beside the first', async () => {
    const { result } = renderAttachment()

    await act(async () => await result.current.choose(slip('first.pdf')))
    const first = result.current.attachment!
    await act(async () => await result.current.choose(slip('second.pdf')))

    expect(discard).toHaveBeenCalledWith(first.path)
    expect(upload.mock.calls[1]![0]).toBe(first.payslipId)
    expect(result.current.attachment!.path).toContain('uuid-second.pdf')
  })

  it('deletes the stored object when the member clears the picker', async () => {
    const { result } = renderAttachment()

    await act(async () => await result.current.choose(slip()))
    const stored = result.current.attachment!
    await act(async () => await result.current.choose(null))

    expect(discard).toHaveBeenCalledWith(stored.path)
    expect(result.current.file).toBeNull()
    expect(result.current.attachment).toBeNull()
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('deletes an upload the member walked away from', async () => {
    const { result, unmount } = renderAttachment()

    await act(async () => await result.current.choose(slip()))
    const stored = result.current.attachment!
    unmount()

    expect(discard).toHaveBeenCalledWith(stored.path)
  })

  it('leaves a saved document alone once the row that references it is written', async () => {
    const { result, unmount } = renderAttachment()

    await act(async () => await result.current.choose(slip()))
    act(() => result.current.keep())
    unmount()

    expect(discard).not.toHaveBeenCalled()
  })

  it('deletes an upload that lands after the form has gone', async () => {
    let finishUpload!: (stored: { payslipId: string; path: string }) => void
    upload.mockReturnValue(
      new Promise<{ payslipId: string; path: string }>((resolve) => {
        finishUpload = resolve
      }),
    )
    const { result, unmount } = renderAttachment()

    let pending!: Promise<void>
    act(() => {
      pending = result.current.choose(slip())
    })
    // Nothing is stored yet, so unmount cleanup has no path to delete.
    unmount()
    expect(discard).not.toHaveBeenCalled()

    await act(async () => {
      finishUpload({ payslipId: 'ps1', path: 'h1/ps1/uuid-slip.pdf' })
      await pending
    })

    expect(discard).toHaveBeenCalledWith('h1/ps1/uuid-slip.pdf')
    expect(read).not.toHaveBeenCalled()
  })

  it('pre-fills nothing from a read that lands after the form has gone', async () => {
    let finishRead!: (outcome: ExtractionOutcome) => void
    read.mockReturnValue(
      new Promise<ExtractionOutcome>((resolve) => {
        finishRead = resolve
      }),
    )
    const { result, unmount } = renderAttachment()

    let pending!: Promise<void>
    act(() => {
      pending = result.current.choose(slip())
    })
    await waitFor(() => expect(read).toHaveBeenCalled())
    const stored = result.current.attachment!
    unmount()

    await act(async () => {
      finishRead({ status: 'read', extraction })
      await pending
    })

    // The document went with the form, so there is nothing to pre-fill into.
    expect(discard).toHaveBeenCalledWith(stored.path)
    expect(onExtracted).not.toHaveBeenCalled()
  })

  it('deletes nothing when no document was ever attached', () => {
    const { unmount } = renderAttachment()
    unmount()
    expect(discard).not.toHaveBeenCalled()
  })

  it('reports a failed upload and attaches nothing', async () => {
    upload.mockRejectedValue(new Error('nope'))
    const { result } = renderAttachment()

    await act(async () => await result.current.choose(slip()))

    expect(result.current.state).toEqual({ status: 'failed', message: UPLOAD_FAILED_MESSAGE })
    expect(result.current.file).toBeNull()
    expect(result.current.attachment).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('keeps the document attached when the read fails, and pre-fills nothing', async () => {
    for (const outcome of [
      { status: 'not-configured', message: 'Not configured.' },
      { status: 'out-of-credit', message: 'Out of credit.' },
      { status: 'key-rejected', message: 'Key refused.' },
      { status: 'not-payslip', message: 'Not a payslip.', reason: 'A bank statement.' },
      { status: 'failed', message: 'Rate limited.' },
    ] satisfies ExtractionOutcome[]) {
      read.mockResolvedValue(outcome)
      const { result, unmount } = renderAttachment()

      await act(async () => await result.current.choose(slip()))

      expect(result.current.state).toEqual(outcome)
      expect(result.current.attachment).not.toBeNull()
      expect(onExtracted).not.toHaveBeenCalled()
      act(() => result.current.keep())
      unmount()
    }
  })
})
