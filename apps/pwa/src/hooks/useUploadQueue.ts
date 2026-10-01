import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_BATCH_FILES, READ_CONCURRENCY, type ReadResult } from '../lib/bulkUpload'
import { prepareUpload } from '../lib/uploadFile'

/** What the queue says when a file could not be stored. */
export const QUEUE_UPLOAD_FAILED_MESSAGE =
  'Could not upload this file. Try again, or remove it and enter the details by hand.'

/**
 * Where one file has got to. `unsupported` and `manual` both hold a stored file
 * with a blank draft: a type that cannot be read, and a file whose reading
 * failed and the member chose to enter by hand.
 */
export type QueueStatus =
  'queued' | 'reading' | 'ready' | 'unsupported' | 'manual' | 'failed' | 'saved'

/** One picked file, with the draft read from it once there is one. */
export interface QueueItem<T, M> {
  /** Minted when the file is added; the record it becomes is written under it, so a retried save cannot duplicate it. */
  id: string
  file: File
  /** What the surface asked for when it added the file, such as a deduction's category. */
  meta: M
  status: QueueStatus
  /** Where the file is stored, or null until it has been uploaded. */
  path: string | null
  /** What was read, or the blank draft for a file entered by hand. */
  value: T | null
  /** Why the file failed or was not read. */
  message: string | null
  /** Whether trying again can help: false for a file over the size limit. */
  retryable: boolean
  /** Whether a saved record references the stored file, so it must not be deleted. */
  kept: boolean
  /** Whether the stored file is a type the model can read. */
  readable: boolean
}

/** The statuses that carry a draft the member can review and save. */
export const DRAFT_STATUSES: readonly QueueStatus[] = ['ready', 'unsupported', 'manual']

export interface UploadQueueOptions<T, M> {
  /** Stores `file` under `id` and resolves to its path. */
  upload: (id: string, file: File) => Promise<string>
  /** Deletes a stored file no record references. Best effort. */
  discard: (path: string) => Promise<void>
  /** Reads a stored file. */
  read: (path: string, file: File, meta: M) => Promise<ReadResult<T>>
  /** The draft for a file entered by hand. */
  blank: () => T
  /** What a file of a type the model cannot read is told. */
  unsupportedMessage: string
}

export interface UploadQueue<T, M> {
  items: QueueItem<T, M>[]
  /** The reason the queue stopped, while it is stopped. */
  halted: string | null
  /** Whether any file is still waiting or being read. */
  working: boolean
  /** Queues `files`, up to the batch limit; resolves to how many were left out. */
  add: (files: File[], meta: M) => number
  /** Takes a file out and deletes its stored copy unless a record references it. */
  remove: (id: string) => void
  /** Queues a failed file to be read again, without storing it twice. */
  retry: (id: string) => void
  /** Turns a failed, stored file into a blank draft to fill in by hand. */
  enterByHand: (id: string) => void
  /** Records that a saved record references the stored file. */
  keep: (id: string) => void
  /** Ends a file's review: `saved` leaves it as a saved row, otherwise it is removed. */
  finish: (id: string, saved: boolean) => void
  /** Removes every file that is not saved, deleting what no record references. */
  clear: () => void
}

/**
 * The queue behind every bulk upload: each file is stored, then read, then
 * handed back as a draft for the member to review. At most
 * {@link READ_CONCURRENCY} files are in flight at once, and each file's outcome
 * is its own — an unreadable, oversized, or unsupported file never stops the
 * others. Only a failure every file would meet (`halt`) stops the queue, leaving
 * the files not yet read marked failed with the same message so the API is not
 * hit once per file.
 *
 * The queue never writes a record. Each file's id is minted here, the stored file
 * is deleted when its draft is discarded, the file removed, or the queue closed
 * (unless a saved record references it), and a file that has been stored is not
 * stored or read again by a retry that does not need to.
 */
export function useUploadQueue<T, M>(options: UploadQueueOptions<T, M>): UploadQueue<T, M> {
  const [items, setItems] = useState<QueueItem<T, M>[]>([])
  const [halted, setHalted] = useState<string | null>(null)
  // The source of truth: updated synchronously so the scheduler and the async
  // steps always see every change made so far, and mirrored into state to render.
  const current = useRef<QueueItem<T, M>[]>([])
  const gone = useRef(false)
  const opts = useRef(options)
  opts.current = options

  const set = useCallback((next: QueueItem<T, M>[]) => {
    current.current = next
    setItems(next)
  }, [])

  const patch = useCallback(
    (id: string, changes: Partial<QueueItem<T, M>>) =>
      set(current.current.map((item) => (item.id === id ? { ...item, ...changes } : item))),
    [set],
  )

  const present = (id: string) => current.current.some((item) => item.id === id)

  const processRef = useRef<((id: string) => Promise<void>) | null>(null)

  /** Starts queued files until {@link READ_CONCURRENCY} are in flight. */
  const pump = useCallback(() => {
    let free = READ_CONCURRENCY - current.current.filter((item) => item.status === 'reading').length
    for (const item of current.current) {
      if (free > 0 && item.status === 'queued') {
        free--
        patch(item.id, { status: 'reading' })
        void processRef.current!(item.id)
      }
    }
  }, [patch])

  processRef.current = async (id: string) => {
    const find = () => current.current.find((item) => item.id === id)!
    if (find().path === null) {
      const prepared = await prepareUpload(find().file)
      if (!present(id)) {
        return
      }
      if (prepared.status === 'too-large') {
        patch(id, { status: 'failed', message: prepared.message, retryable: false })
        pump()
        return
      }
      let path: string
      try {
        path = await opts.current.upload(id, prepared.file)
      } catch {
        if (present(id)) {
          patch(id, { status: 'failed', message: QUEUE_UPLOAD_FAILED_MESSAGE })
          pump()
        }
        return
      }
      if (gone.current || !present(id)) {
        // Nothing holds this path: its row was removed, or the panel closed,
        // while the upload was in flight.
        void opts.current.discard(path)
        return
      }
      patch(id, { path, readable: prepared.readable })
    }

    const { path, file, meta, readable } = find()
    if (!readable) {
      patch(id, {
        status: 'unsupported',
        value: opts.current.blank(),
        message: opts.current.unsupportedMessage,
      })
      pump()
      return
    }

    const result = await opts.current.read(path!, file, meta)
    if (!present(id)) {
      return
    }
    switch (result.status) {
      case 'read':
        patch(id, { status: 'ready', value: result.value, message: null })
        break
      case 'unsupported':
        patch(id, { status: 'unsupported', value: opts.current.blank(), message: result.message })
        break
      case 'failed':
        patch(id, { status: 'failed', message: result.message })
        break
      case 'halt':
        setHalted(result.message)
        set(
          current.current.map((item) =>
            item.id === id || item.status === 'queued'
              ? { ...item, status: 'failed', message: result.message }
              : item,
          ),
        )
        break
    }
    pump()
  }

  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      for (const item of current.current) {
        if (item.path !== null && !item.kept) {
          void opts.current.discard(item.path)
        }
      }
    }
  }, [])

  const add = useCallback(
    (files: File[], meta: M): number => {
      const open = current.current.filter((item) => item.status !== 'saved').length
      const room = Math.max(0, MAX_BATCH_FILES - open)
      const accepted = files.slice(0, room)
      if (accepted.length > 0) {
        setHalted(null)
        set([
          ...current.current,
          ...accepted.map((file): QueueItem<T, M> => ({
            id: crypto.randomUUID(),
            file,
            meta,
            status: 'queued',
            path: null,
            value: null,
            message: null,
            retryable: true,
            kept: false,
            readable: true,
          })),
        ])
        pump()
      }
      return files.length - accepted.length
    },
    [pump, set],
  )

  const remove = useCallback(
    (id: string) => {
      const item = current.current.find((candidate) => candidate.id === id)
      if (item?.path != null && !item.kept) {
        void opts.current.discard(item.path)
      }
      set(current.current.filter((candidate) => candidate.id !== id))
      pump()
    },
    [pump, set],
  )

  const retry = useCallback(
    (id: string) => {
      setHalted(null)
      patch(id, { status: 'queued', message: null })
      pump()
    },
    [patch, pump],
  )

  const enterByHand = useCallback(
    (id: string) => patch(id, { status: 'manual', value: opts.current.blank() }),
    [patch],
  )

  const keep = useCallback((id: string) => patch(id, { kept: true }), [patch])

  const finish = useCallback(
    (id: string, saved: boolean) => {
      if (saved) {
        patch(id, { status: 'saved', kept: true })
      } else {
        remove(id)
      }
    },
    [patch, remove],
  )

  const clear = useCallback(() => {
    for (const item of current.current) {
      if (item.path !== null && !item.kept) {
        void opts.current.discard(item.path)
      }
    }
    set([])
    setHalted(null)
  }, [set])

  return {
    items,
    halted,
    working: items.some((item) => item.status === 'queued' || item.status === 'reading'),
    add,
    remove,
    retry,
    enterByHand,
    keep,
    finish,
    clear,
  }
}
