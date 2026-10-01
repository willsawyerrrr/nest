/**
 * How the edge functions treat a stored file's type. The PWA decides the same
 * thing from the same table (`apps/pwa/src/lib/uploadFile.ts`): the extension
 * alone says whether a file is one the model can read and a browser may show
 * inline, so the two sides never disagree.
 */

/** Types the extraction model reads and a browser shows inline without risk, by extension. */
const INLINE_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'])

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/

/**
 * Storage's options for a signed URL: nothing for a file that is safe to show in
 * the browser, and a forced download named for the file (without its generated
 * `<uuid>-` prefix) for every other type, so active content such as HTML or SVG
 * is saved rather than rendered.
 */
export function signedUrlOptions(path: string): { download: string } | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  return INLINE_EXTENSIONS.has(extension) ? undefined : { download: name.replace(UUID_PREFIX, '') }
}
