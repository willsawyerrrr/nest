/**
 * What the bulk upload queue shares across the surfaces that take many files at
 * once (deduction receipts, payslips, trade documents): the limits on a batch,
 * the shape of one file's reading, and the draft a surface's form starts from.
 */

/** The most files a member can have in flight or awaiting review at once. */
export const MAX_BATCH_FILES = 20

/** How many files are read at the same time. */
export const READ_CONCURRENCY = 3

/**
 * How reading one stored file ended, in the terms the queue acts on.
 * `halt` is a failure that every other file would meet too (reading switched
 * off, or out of credit), so it stops the queue instead of being repeated.
 */
export type ReadResult<T> =
  | { status: 'read'; value: T }
  | { status: 'unsupported'; message: string }
  | { status: 'failed'; message: string }
  | { status: 'halt'; message: string }

/**
 * A stored file, as a surface's form starts from it: where it was stored, what
 * was read off it (null when nothing was, so the figures are typed by hand).
 */
export interface UploadDraft<T> {
  /** The id minted for the file, which the saved record is written under. */
  id: string
  path: string
  extraction: T | null
}

/** The copy for a batch that was cut to {@link MAX_BATCH_FILES}. */
export function batchLimitMessage(skipped: number): string {
  return `${skipped === 1 ? '1 file was' : `${skipped} files were`} left out: at most ${MAX_BATCH_FILES} files can be open at once. Save or discard some, then add the rest.`
}
