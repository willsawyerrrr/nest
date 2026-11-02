/**
 * The APNs send path, shared by every function that pushes to a native device:
 * an ES256 provider token signed with the APNs auth key (`.p8`) and an HTTP/2
 * POST to Apple's push host.
 *
 * It mirrors `webpush.ts`: {@link createApnsSender} binds the configured
 * credentials once and returns a function that attempts one device, resolving —
 * never throwing — with a {@link DeliveryOutcome}, so one failing device neither
 * aborts a pass nor loses its summary. The caller owns the prune of the rows
 * {@link DeliveryOutcome} marks gone.
 *
 * The credential set (key id, team id, bundle id, private key) is read from
 * Vault through the service-role-only `apns_keys()` RPC. The operator creates and
 * rotates it by hand; see `docs/operations.md`.
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { decodeBase64, encodeBase64Url } from '@std/encoding'
import type { DeliveryOutcome, PushPayload } from './webpush.ts'

export interface ApnsKeys {
  /** The 10-character id of the APNs auth key, the provider token's `kid`. */
  keyId: string
  /** The Apple Developer team id, the provider token's `iss`. */
  teamId: string
  /** The app's bundle id, sent as the `apns-topic`. */
  bundleId: string
  /** The PEM (PKCS#8) contents of the `.p8` auth key. */
  privateKey: string
}

/** Which APNs host a token belongs to. */
export type ApnsEnvironment = 'sandbox' | 'production'

/** One native install, as stored in `apns_device`. */
export interface ApnsDevice {
  id: string
  token: string
  environment: ApnsEnvironment
}

export type ApnsSender = (device: ApnsDevice, payload: PushPayload) => Promise<DeliveryOutcome>

const HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

/**
 * Apple rejects a provider token older than an hour and a freshly minted one
 * too often, so one token serves a sender for this long.
 */
const TOKEN_TTL_MS = 50 * 60 * 1000

/**
 * Shape the `apns_keys()` row into a usable credential set, or `null` when it
 * is incomplete. A `.p8` pasted into Vault with its newlines escaped is repaired
 * here so it still parses.
 */
export function normaliseApnsKeys(row: unknown): ApnsKeys | null {
  const fields = row as
    | { key_id?: unknown; team_id?: unknown; bundle_id?: unknown; private_key?: unknown }
    | null
    | undefined
  const keyId = trimmed(fields?.key_id)
  const teamId = trimmed(fields?.team_id)
  const bundleId = trimmed(fields?.bundle_id)
  const privateKey = trimmed(fields?.private_key).replaceAll('\\n', '\n')
  if (!keyId || !teamId || !bundleId || !privateKey) return null
  return { keyId, teamId, bundleId, privateKey }
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Fetch and normalise the credential set; `null` when unset or unreadable. */
export async function loadApnsKeys(admin: SupabaseClient): Promise<ApnsKeys | null> {
  const { data, error } = await admin.rpc('apns_keys')
  if (error) return null
  // `returns table (...)` surfaces as a one-row array through PostgREST.
  return normaliseApnsKeys(Array.isArray(data) ? data[0] : data)
}

/** Import the `.p8` PEM as an ECDSA P-256 signing key. Throws when it is malformed. */
export function importApnsPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  let der: Uint8Array<ArrayBuffer>
  try {
    der = decodeBase64(body)
  } catch {
    throw new Error('apns_private_key is not a PEM-encoded PKCS#8 key')
  }
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
}

/** The ES256 provider token (a JWT) APNs authenticates the sender with. */
export async function signProviderToken(
  key: CryptoKey,
  keys: Pick<ApnsKeys, 'keyId' | 'teamId'>,
  issuedAt: Date,
): Promise<string> {
  const encoder = new TextEncoder()
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ alg: 'ES256', kid: keys.keyId })))
  const claims = encodeBase64Url(
    encoder.encode(
      JSON.stringify({ iss: keys.teamId, iat: Math.floor(issuedAt.getTime() / 1000) }),
    ),
  )
  const signingInput = `${header}.${claims}`
  // WebCrypto's ECDSA signature is the raw r || s a JWT expects, not DER.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  )
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`
}

/** The body the app renders and routes on: the alert plus the in-app `url` to open. */
export function apnsBody(payload: PushPayload): string {
  return JSON.stringify({
    aps: { alert: { title: payload.title, body: payload.body }, sound: 'default' },
    url: payload.url,
  })
}

/**
 * Whether APNs reported the token dead for good: 410 (the app was uninstalled or
 * the token expired) or a 400 `BadDeviceToken`. Anything else — a rejected
 * provider token, throttling, a 5xx, a timeout — may deliver on the next attempt.
 */
export function isGone(status: number, reason: string | null): boolean {
  return status === 410 || (status === 400 && reason === 'BadDeviceToken')
}

async function responseReason(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { reason?: unknown }
    return typeof body.reason === 'string' ? body.reason : null
  } catch {
    return null
  }
}

/**
 * Bind a sender to the configured APNs credentials. Throws when the private key
 * is malformed, so a mistyped secret is reported as a misconfiguration rather
 * than as an opaque delivery failure.
 *
 * `fetchFn` and `now` are injectable for tests.
 */
export async function createApnsSender(
  keys: ApnsKeys,
  { fetchFn = fetch, now = () => new Date() }: {
    fetchFn?: typeof fetch
    now?: () => Date
  } = {},
): Promise<ApnsSender> {
  const signingKey = await importApnsPrivateKey(keys.privateKey)
  let cached: { token: string; mintedAt: number } | null = null

  const providerToken = async (): Promise<string> => {
    const current = now()
    if (!cached || current.getTime() - cached.mintedAt >= TOKEN_TTL_MS) {
      cached = {
        token: await signProviderToken(signingKey, keys, current),
        mintedAt: current.getTime(),
      }
    }
    return cached.token
  }

  return async (device, payload): Promise<DeliveryOutcome> => {
    try {
      const response = await fetchFn(`${HOSTS[device.environment]}/3/device/${device.token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${await providerToken()}`,
          'apns-topic': keys.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'content-type': 'application/json',
        },
        body: apnsBody(payload),
      })
      if (response.status === 200) {
        await response.body?.cancel()
        return { delivered: true }
      }
      return { delivered: false, gone: isGone(response.status, await responseReason(response)) }
    } catch {
      return { delivered: false, gone: false }
    }
  }
}
