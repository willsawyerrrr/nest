import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BATCH_FILES, READ_CONCURRENCY, type ReadResult } from '../lib/bulkUpload'
import { FILE_TOO_LARGE_MESSAGE, MAX_UPLOAD_BYTES } from '../lib/uploadFile'
import { QUEUE_UPLOAD_FAILED_MESSAGE, useUploadQueue } from './useUploadQueue'

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()

function pdf(name = 'a.pdf') {
  return new File(['x'], name, { type: 'application/pdf' })
}

function renderQueue() {
  return renderHook(() =>
    useUploadQueue<string, string>({
      upload,
      discard,
      read,
      blank: () => 'blank',
      unsupportedMessage: 'cannot read',
    }),
  )
}

function statuses(items: { file: File; status: string }[]) {
  return items.map((item) => `${item.file.name}:${item.status}`)
}

/** A read the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(async (id: string, file: File) => `h1/${id}/${file.name}`)
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({ status: 'read', value: 'read' } satisfies ReadResult<string>)
})

describe('useUploadQueue', () => {
  it('stores, reads, and holds each file as a draft', async () => {
    const { result } = renderQueue()
    act(() => void result.current.add([pdf('a.pdf'), pdf('b.pdf')], 'meta'))

    await waitFor(() =>
      expect(statuses(result.current.items)).toEqual(['a.pdf:ready', 'b.pdf:ready']),
    )
    const [first] = result.current.items
    expect(first).toMatchObject({ value: 'read', meta: 'meta', kept: false })
    expect(upload).toHaveBeenCalledWith(first!.id, expect.any(File))
    expect(read).toHaveBeenCalledWith(first!.path, expect.any(File), 'meta')
    expect(result.current.working).toBe(false)
  })

  it('reads at most three files at a time and starts the next as one finishes', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<ReadResult<string>>())
    read.mockImplementation(
      (_path: string, file: File) => gates[Number(file.name.charAt(0))]!.promise,
    )
    const { result } = renderQueue()
    act(
      () =>
        void result.current.add(
          ['0', '1', '2', '3'].map((n) => pdf(`${n}.pdf`)),
          'm',
        ),
    )

    await waitFor(() => expect(read).toHaveBeenCalledTimes(READ_CONCURRENCY))
    expect(statuses(result.current.items)).toEqual([
      '0.pdf:reading',
      '1.pdf:reading',
      '2.pdf:reading',
      '3.pdf:queued',
    ])
    expect(result.current.working).toBe(true)

    await act(async () => gates[0]!.resolve({ status: 'read', value: 'v' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(4))
    expect(result.current.items[3]!.status).toBe('reading')
  })

  it('lets one file fail without stopping the others', async () => {
    read.mockImplementation(async (_path: string, file: File) =>
      file.name === 'bad.pdf'
        ? { status: 'failed', message: 'not a receipt' }
        : { status: 'read', value: 'v' },
    )
    const { result } = renderQueue()
    act(() => void result.current.add([pdf('bad.pdf'), pdf('good.pdf')], 'm'))

    await waitFor(() =>
      expect(statuses(result.current.items)).toEqual(['bad.pdf:failed', 'good.pdf:ready']),
    )
    expect(result.current.items[0]).toMatchObject({ message: 'not a receipt', retryable: true })
    expect(result.current.halted).toBeNull()
  })

  it('attaches a type the model cannot read for hand entry without reading it', async () => {
    const { result } = renderQueue()
    act(() => void result.current.add([new File(['x'], 'sheet.xlsx')], 'm'))

    await waitFor(() => expect(result.current.items[0]!.status).toBe('unsupported'))
    expect(result.current.items[0]).toMatchObject({ value: 'blank', message: 'cannot read' })
    expect(read).not.toHaveBeenCalled()
  })

  it('takes an unsupported verdict from the read too', async () => {
    read.mockResolvedValue({ status: 'unsupported', message: 'nope' })
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))

    await waitFor(() => expect(result.current.items[0]!.status).toBe('unsupported'))
    expect(result.current.items[0]).toMatchObject({ value: 'blank', message: 'nope' })
  })

  it('refuses a file over the size limit without storing it or offering a retry', async () => {
    const big = new File(['x'], 'big.pdf')
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    const { result } = renderQueue()
    act(() => void result.current.add([big, pdf('ok.pdf')], 'm'))

    await waitFor(() =>
      expect(statuses(result.current.items)).toEqual(['big.pdf:failed', 'ok.pdf:ready']),
    )
    expect(result.current.items[0]).toMatchObject({
      message: FILE_TOO_LARGE_MESSAGE,
      retryable: false,
    })
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('fails a file that cannot be stored, and stores it on retry', async () => {
    upload.mockRejectedValueOnce(new Error('network'))
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))

    await waitFor(() => expect(result.current.items[0]!.status).toBe('failed'))
    expect(result.current.items[0]).toMatchObject({
      message: QUEUE_UPLOAD_FAILED_MESSAGE,
      path: null,
    })

    act(() => result.current.retry(result.current.items[0]!.id))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('ready'))
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('retries a failed read without storing the file again', async () => {
    read.mockResolvedValueOnce({ status: 'failed', message: 'busy' })
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('failed'))

    act(() => result.current.retry(result.current.items[0]!.id))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('ready'))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('turns a failed, stored file into a blank draft to fill in by hand', async () => {
    read.mockResolvedValue({ status: 'failed', message: 'busy' })
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('failed'))

    act(() => result.current.enterByHand(result.current.items[0]!.id))
    expect(result.current.items[0]).toMatchObject({ status: 'manual', value: 'blank' })
  })

  it('stops the queue on a failure every file would meet, and restarts it on retry', async () => {
    read.mockResolvedValueOnce({ status: 'halt', message: 'out of credit' })
    const gate = deferred<ReadResult<string>>()
    read.mockReturnValueOnce(gate.promise).mockReturnValueOnce(gate.promise)
    const { result } = renderQueue()
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => pdf(`${n}.pdf`))
    act(() => void result.current.add(files, 'm'))

    await waitFor(() => expect(result.current.halted).toBe('out of credit'))
    // Queued files are failed with the same message rather than read.
    expect(result.current.items.filter((item) => item.status === 'failed')).toHaveLength(3)
    expect(read).toHaveBeenCalledTimes(3)

    await act(async () => gate.resolve({ status: 'read', value: 'v' }))
    act(() => result.current.retry(result.current.items[0]!.id))
    expect(result.current.halted).toBeNull()
    await waitFor(() => expect(result.current.items[0]!.status).toBe('ready'))
  })

  it('caps a batch at the file limit and reports how many were left out', () => {
    const { result } = renderQueue()
    const files = Array.from({ length: MAX_BATCH_FILES + 3 }, (_, i) => pdf(`${i}.pdf`))
    let skipped = 0
    act(() => {
      skipped = result.current.add(files, 'm')
    })
    expect(skipped).toBe(3)
    expect(result.current.items).toHaveLength(MAX_BATCH_FILES)

    act(() => {
      skipped = result.current.add([pdf('more.pdf')], 'm')
    })
    expect(skipped).toBe(1)
  })

  it('does not count saved files against the limit', async () => {
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('ready'))
    act(() => result.current.finish(result.current.items[0]!.id, true))
    expect(result.current.items[0]).toMatchObject({ status: 'saved', kept: true })

    let skipped = 0
    act(() => {
      skipped = result.current.add(
        Array.from({ length: MAX_BATCH_FILES }, (_, i) => pdf(`${i}.pdf`)),
        'm',
      )
    })
    expect(skipped).toBe(0)
  })

  it('adds nothing for an empty pick', () => {
    const { result } = renderQueue()
    act(() => void result.current.add([], 'm'))
    expect(result.current.items).toEqual([])
  })

  it('deletes the stored file of a removed file, but not one a record references', async () => {
    const { result } = renderQueue()
    act(() => void result.current.add([pdf('a.pdf'), pdf('b.pdf')], 'm'))
    await waitFor(() =>
      expect(statuses(result.current.items)).toEqual(['a.pdf:ready', 'b.pdf:ready']),
    )
    const [a, b] = result.current.items

    act(() => result.current.keep(b!.id))
    act(() => result.current.remove(a!.id))
    act(() => result.current.remove(b!.id))
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith(a!.path)
    expect(result.current.items).toEqual([])
  })

  it('removes a file that was never stored without deleting anything', () => {
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    act(() => result.current.remove('unknown'))
    act(() => result.current.remove(result.current.items[0]!.id))
    expect(discard).not.toHaveBeenCalled()
  })

  it('finishing a file as not saved removes it and deletes its stored file', async () => {
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(result.current.items[0]!.status).toBe('ready'))
    const path = result.current.items[0]!.path

    act(() => result.current.finish(result.current.items[0]!.id, false))
    expect(result.current.items).toEqual([])
    expect(discard).toHaveBeenCalledWith(path)
  })

  it('deletes a file removed while it is being stored, once the upload lands', async () => {
    const gate = deferred<string>()
    upload.mockReturnValueOnce(gate.promise)
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(upload).toHaveBeenCalled())

    act(() => result.current.remove(result.current.items[0]!.id))
    await act(async () => gate.resolve('h1/late.pdf'))
    expect(discard).toHaveBeenCalledWith('h1/late.pdf')
    expect(read).not.toHaveBeenCalled()
  })

  it('drops a read for a file removed while it was being read', async () => {
    const gate = deferred<ReadResult<string>>()
    read.mockReturnValueOnce(gate.promise)
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(read).toHaveBeenCalled())

    act(() => result.current.remove(result.current.items[0]!.id))
    await act(async () => gate.resolve({ status: 'read', value: 'v' }))
    expect(result.current.items).toEqual([])
  })

  it('ignores an upload that fails for a file removed meanwhile', async () => {
    const gate = deferred<string>()
    upload.mockReturnValueOnce(gate.promise)
    const { result } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(upload).toHaveBeenCalled())

    act(() => result.current.remove(result.current.items[0]!.id))
    await act(async () => gate.reject(new Error('network')))
    expect(result.current.items).toEqual([])
    expect(discard).not.toHaveBeenCalled()
  })

  it('stores nothing for a file removed before it has been checked', async () => {
    const { result } = renderQueue()
    act(() => {
      result.current.add([pdf()], 'm')
      result.current.remove(result.current.items[0]?.id ?? '')
    })
    await act(async () => {})
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('deletes every stored file no record references when the queue is cleared', async () => {
    const { result } = renderQueue()
    act(() => void result.current.add([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], 'm'))
    await waitFor(() =>
      expect(result.current.items.every((item) => item.status === 'ready')).toBe(true),
    )
    const [a, b, c] = result.current.items
    act(() => result.current.finish(b!.id, true))

    act(() => result.current.clear())
    expect(result.current.items).toEqual([])
    expect(discard).toHaveBeenCalledTimes(2)
    expect(discard).toHaveBeenCalledWith(a!.path)
    expect(discard).toHaveBeenCalledWith(c!.path)
  })

  it('deletes unreferenced files when it unmounts', async () => {
    const { result, unmount } = renderQueue()
    act(() => void result.current.add([pdf('a.pdf'), pdf('b.pdf')], 'm'))
    await waitFor(() =>
      expect(result.current.items.every((item) => item.status === 'ready')).toBe(true),
    )
    const [a, b] = result.current.items
    act(() => result.current.keep(b!.id))

    unmount()
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith(a!.path)
  })

  it('deletes a file whose upload lands after it unmounts', async () => {
    const gate = deferred<string>()
    upload.mockReturnValueOnce(gate.promise)
    const { result, unmount } = renderQueue()
    act(() => void result.current.add([pdf()], 'm'))
    await waitFor(() => expect(upload).toHaveBeenCalled())

    unmount()
    await act(async () => gate.resolve('h1/late.pdf'))
    expect(discard).toHaveBeenCalledWith('h1/late.pdf')
  })
})
