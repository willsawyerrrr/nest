/**
 * Verification of Up's `X-Up-Authenticity-Signature` header. Up signs each
 * delivery with a hex HMAC-SHA256 of the raw request body, keyed by the
 * webhook's secret. Kept in a server-free module so it can be unit-tested
 * without starting the function.
 */

/** Hex-encodes bytes for comparison against Up's signature header. */
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Length-safe, constant-time comparison of two hex signature strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/** Verifies the request signature against the raw body using the webhook secret. */
export async function isSignatureValid(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return timingSafeEqual(toHex(mac), signature)
}
