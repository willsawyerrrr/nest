/**
 * The real Web Push sender: an ES256 VAPID JWT (RFC 8292) plus an aes128gcm
 * payload encrypted to the subscription's keys (RFC 8291).
 *
 * `@negrel/webpush` does the ECDH → HKDF → AES-GCM chain over WebCrypto alone,
 * so none of it is hand-rolled here; this module supplies the two things the
 * library leaves to the caller — converting the stored base64url keypair into the
 * JWK pair it imports, and classifying a failure as dead-endpoint or transient.
 */

import * as webpush from '@negrel/webpush'
import { decodeBase64Url, encodeBase64Url } from '@std/encoding/base64url'
import type { VapidKeys } from '../_shared/vapid.ts'
import type { DeliveryOutcome, PushSender } from './send.ts'

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
 * payload's encryption distinct.
 */
export async function createSender(keys: VapidKeys): Promise<PushSender> {
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
