/*
 * The pure parts of the Web Push chain: the base64url conversions the browser's
 * `PushManager` and the `push_subscription` row need, and the payload parsing the
 * service worker runs on an incoming push. Kept out of `sw.ts` so they are
 * exercised directly by tests rather than through a worker.
 */

/** The `{ title, body, url }` payload a push carries, and a notification shows. */
export interface PushPayload {
  title: string
  body: string
  url: string
}

/**
 * Shown when a push arrives with no payload, an unparseable one, or one missing
 * the fields a notification needs. A push that reaches the device must always
 * surface something — a silent push is a permission violation in every browser
 * that implements `userVisibleOnly` — so parsing degrades to this rather than
 * failing.
 */
const FALLBACK_PAYLOAD: PushPayload = {
  title: 'nest',
  body: 'Open nest to see what changed.',
  url: '/',
}

/** Reads a string field off a parsed payload, or null when it is absent or not a string. */
function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Parses a push's raw JSON body into a payload, falling back to a sane
 * notification for an absent, unparseable, or incomplete body. Each field falls
 * back independently, so a payload carrying only a title still shows that title.
 */
export function parsePushPayload(raw: string | null | undefined): PushPayload {
  if (raw == null || raw === '') {
    return FALLBACK_PAYLOAD
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return FALLBACK_PAYLOAD
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return FALLBACK_PAYLOAD
  }

  const payload = parsed as Record<string, unknown>
  return {
    title: stringField(payload, 'title') ?? FALLBACK_PAYLOAD.title,
    body: stringField(payload, 'body') ?? FALLBACK_PAYLOAD.body,
    url: stringField(payload, 'url') ?? FALLBACK_PAYLOAD.url,
  }
}

/**
 * The in-app path a clicked notification should land on, read from the `data`
 * the `push` handler attached to it. Falls back to the app root whenever that
 * data is missing or malformed, so a click always opens the app.
 */
export function notificationUrl(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return FALLBACK_PAYLOAD.url
  }
  return stringField(data as Record<string, unknown>, 'url') ?? FALLBACK_PAYLOAD.url
}

/**
 * Decodes a base64url string — the form a VAPID public key is served in — into
 * the `Uint8Array` `pushManager.subscribe` expects as its
 * `applicationServerKey`. base64url swaps `+`/`/` for `-`/`_` and drops the
 * padding, so both are restored before decoding.
 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Encodes the raw bytes of a subscription key (`p256dh` or `auth`, which the
 * browser hands over as an `ArrayBuffer`) as base64url, the form the
 * `push_subscription` row and the server's Web Push encryption both use.
 */
export function bytesToBase64Url(buffer: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
