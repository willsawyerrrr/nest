/**
 * The Web Push send path, shared by every function that pushes to a device: an
 * ES256 VAPID JWT (RFC 8292) plus an aes128gcm payload encrypted to the
 * subscription's keys (RFC 8291).
 *
 * `@negrel/webpush` does the ECDH → HKDF → AES-GCM chain over WebCrypto alone,
 * so none of it is hand-rolled here; this module supplies the three things the
 * library leaves to the caller — converting the stored base64url keypair into the
 * JWK pair it imports, classifying a failure as dead-endpoint or transient, and
 * binding one application server to the configured keypair so a whole pass of
 * devices is served from a single ECDH keypair.
 *
 * `push-test` sends to the caller's own devices; `notify-eval` sends a trigger
 * alert to a household member's devices. Both bind one sender with
 * {@link createPushSender} and attempt each device independently, deleting the
 * rows {@link isGone} identifies (each function owns its own delete — the row's
 * table and the client are the function's, not this module's).
 */

import * as webpush from '@negrel/webpush'
import { decodeBase64Url, encodeBase64Url } from '@std/encoding/base64url'
import type { VapidKeys } from './vapid.ts'

/** One opted-in device, as stored in `push_subscription`. */
export interface PushDevice {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/** The notification body the service worker renders and routes on. */
export interface PushPayload {
  title: string
  body: string
  /** Where `notificationclick` navigates. */
  url: string
}

/** The outcome of one device's delivery attempt. */
export type DeliveryOutcome =
  | { delivered: true }
  /**
   * `gone` is true only when the push service reported the subscription as
   * absent (404) or expired (410) — the device unsubscribed, so its row is dead.
   * Every other failure (a 5xx, a timeout, a rejected VAPID token) leaves the
   * row alone: it may well deliver on the next attempt.
   */
  | { delivered: false; gone: boolean }

/** Sends one encrypted push. Resolves — never throws — with the outcome. */
export type PushSender = (device: PushDevice, payload: PushPayload) => Promise<DeliveryOutcome>

/** An uncompressed P-256 point is the 0x04 tag plus a 32-byte X and Y. */
const UNCOMPRESSED_POINT_BYTES = 65
const SCALAR_BYTES = 32

/**
 * Split the stored raw keypair — the ubiquitous `web-push generate-vapid-keys`
 * format, a base64url uncompressed point and a base64url private scalar — into
 * the JWK pair WebCrypto imports. Throws when either key is malformed, so a
 * mistyped secret fails loudly at startup rather than as an opaque push failure.
 */
export function vapidJwkFromRaw(keys: VapidKeys): webpush.ExportedVapidKeys {
  const point = decodeSecret(keys.publicKey, 'vapid_public_key')
  if (point.length !== UNCOMPRESSED_POINT_BYTES || point[0] !== 0x04) {
    throw new Error('vapid_public_key is not a base64url uncompressed P-256 point')
  }
  const scalar = decodeSecret(keys.privateKey, 'vapid_private_key')
  if (scalar.length !== SCALAR_BYTES) {
    throw new Error('vapid_private_key is not a base64url 32-byte P-256 scalar')
  }

  // Re-encode rather than pass the stored strings through, so padded base64url
  // (which JWK forbids) is normalised.
  const x = encodeBase64Url(point.subarray(1, 1 + SCALAR_BYTES))
  const y = encodeBase64Url(point.subarray(1 + SCALAR_BYTES))
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y },
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d: encodeBase64Url(scalar) },
  }
}

/** Decode a stored secret, naming it in the error so a typo is diagnosable. */
function decodeSecret(value: string, name: string): Uint8Array {
  try {
    return decodeBase64Url(value)
  } catch {
    throw new Error(`${name} is not valid base64url`)
  }
}

/**
 * A push service answers 404 when it has never heard of the endpoint and 410
 * Gone when the subscription has expired; both mean the device is unsubscribed
 * for good and its row should go. Anything else is transient.
 */
export function isGone(error: unknown): boolean {
  if (!(error instanceof webpush.PushMessageError)) return false
  return error.response.status === 404 || error.response.status === 410
}

/**
 * Bind a sender to the configured VAPID keys. One application server (and so one
 * ECDH keypair) serves every device in a pass; the per-message salt keeps each
 * payload's encryption distinct. The returned function resolves — never throws —
 * so one failing endpoint neither aborts a `Promise.all` over the others nor
 * loses the run's summary.
 */
export async function createPushSender(keys: VapidKeys): Promise<PushSender> {
  const server = await webpush.ApplicationServer.new({
    contactInformation: keys.subject,
    vapidKeys: await webpush.importVapidKeys(vapidJwkFromRaw(keys), { extractable: false }),
  })

  return async (device, payload): Promise<DeliveryOutcome> => {
    const subscriber = server.subscribe({
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    })
    try {
      // High urgency so an installed iOS PWA is woken rather than batched.
      await subscriber.pushTextMessage(JSON.stringify(payload), {
        urgency: webpush.Urgency.High,
      })
      return { delivered: true }
    } catch (error) {
      return { delivered: false, gone: isGone(error) }
    }
  }
}
