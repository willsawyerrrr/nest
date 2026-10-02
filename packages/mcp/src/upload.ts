/**
 * What the server does with a file it uploads. Mirrors the PWA's table
 * (`apps/pwa/src/lib/uploadFile.ts`) and the edge functions': any type is
 * accepted and stored, the extension alone decides the stored content type and
 * whether extraction reads it, and nothing is ever stored under a type a
 * browser would render.
 */

/** The largest file stored, matching the PWA and the Storage buckets. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const READABLE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The content type Storage records: the readable type, else `application/octet-stream`. */
export function storedContentType(name: string): string {
  return READABLE_MEDIA_TYPES[extensionOf(name)] ?? 'application/octet-stream'
}

/** Whether the extraction model can read the file named `name`. */
export function canExtract(name: string): boolean {
  return extensionOf(name) in READABLE_MEDIA_TYPES
}

const MAX_KEY_NAME_LENGTH = 100

/** A file name safe as the last segment of a Storage key. */
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
