/**
 * What the app does with a file a member attaches, wherever it takes an upload
 * (deduction receipts, payslips, trade documents). Any type is accepted and
 * stored; only the types the extraction model can read are read.
 *
 * The extension decides everything — the content type Storage records, whether
 * the model can read the file, and whether it may be shown inline — so the three
 * never disagree and a file's claimed type cannot talk it into rendering. The
 * edge functions mirror the same table (`supabase/functions/_shared/fileType.ts`).
 */

/** The largest file the app stores, enforced here and by the Storage buckets. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** The `code` an extraction function answers with for a file type it cannot read. */
export const UNSUPPORTED_TYPE_CODE = 'unsupported_type'

/** What a member is told when a file is over {@link MAX_UPLOAD_BYTES}. */
export const FILE_TOO_LARGE_MESSAGE = 'That file is too large. The limit is 25 MB.'

/** Types the extraction model reads and a browser shows inline without risk, by extension. */
const READABLE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

const HEIC_EXTENSIONS: ReadonlySet<string> = new Set(['heic', 'heif'])

/** The lower-cased extension of a file name or path, or empty when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The last segment of a path, so a dot in a folder name is never an extension. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * The content type Storage records for a file: its readable type, or the opaque
 * `application/octet-stream` for anything else, so an HTML or SVG upload is never
 * stored as a type a browser would render.
 */
export function storedContentType(name: string): string {
  return READABLE_MEDIA_TYPES[extensionOf(name)] ?? 'application/octet-stream'
}

/** Whether the extraction model can read the file named `name`. */
export function canExtract(name: string): boolean {
  return extensionOf(name) in READABLE_MEDIA_TYPES
}

/**
 * The stored object's name without its generated `<uuid>-` prefix: what a
 * downloaded copy is called.
 */
export function downloadName(path: string): string {
  return baseName(path).replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    '',
  )
}

/**
 * Storage's options for a signed URL: nothing for a file that is safe to show
 * in the browser, and a forced download for every other type, so active content
 * such as HTML or SVG is saved rather than rendered.
 */
export function signedUrlOptions(path: string): { download: string } | undefined {
  return canExtract(path) ? undefined : { download: downloadName(path) }
}

/** The longest file name kept in a Storage key. */
const MAX_KEY_NAME_LENGTH = 100

/**
 * A file name safe to use as the last segment of a Storage key: letters, digits,
 * dots, dashes and underscores only, so no name a member's device produces is
 * rejected, and no more than {@link MAX_KEY_NAME_LENGTH} characters with the
 * extension kept.
 */
export function storageKeyName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 ? cleaned.slice(dot) : ''
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).replace(/^[._]+/, '')
  return (stem.slice(0, MAX_KEY_NAME_LENGTH - extension.length) || 'file') + extension
}

/** The outcome of getting a picked file ready to store. */
export type PreparedUpload =
  { status: 'ready'; file: File; readable: boolean } | { status: 'too-large'; message: string }

/**
 * Re-encodes a HEIC/HEIF photo as a JPEG where the browser can decode it, so it
 * can be read and shown anywhere. Resolves to the original file when the browser
 * cannot decode HEIC.
 */
async function heicToJpeg(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (blob === null) {
      return file
    }
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/**
 * Gets a picked file ready to store: rejects one over the size limit, and
 * converts a HEIC/HEIF photo to JPEG where it can. `readable` says whether the
 * extraction model can read what will be stored.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { status: 'too-large', message: FILE_TOO_LARGE_MESSAGE }
  }
  const prepared = HEIC_EXTENSIONS.has(extensionOf(file.name)) ? await heicToJpeg(file) : file
  return { status: 'ready', file: prepared, readable: canExtract(prepared.name) }
}
