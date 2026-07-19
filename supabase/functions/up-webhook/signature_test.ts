import { assert, assertEquals, assertFalse } from '@std/assert'
import { isSignatureValid, timingSafeEqual, toHex } from './signature.ts'

/** Computes the reference hex HMAC-SHA256 the way Up signs a delivery. */
async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return toHex(mac)
}

Deno.test('isSignatureValid accepts a signature computed with the same secret and body', async () => {
  const body = '{"data":{"attributes":{"eventType":"PING"}}}'
  const secret = 'up-webhook-secret'
  assert(await isSignatureValid(body, await sign(body, secret), secret))
})

Deno.test('isSignatureValid rejects a tampered signature', async () => {
  const body = '{"data":{"attributes":{"eventType":"PING"}}}'
  const secret = 'up-webhook-secret'
  const signature = await sign(body, secret)
  const tampered = signature.slice(0, -1) + (signature.at(-1) === '0' ? '1' : '0')
  assertFalse(await isSignatureValid(body, tampered, secret))
})

Deno.test('isSignatureValid rejects a signature made with a different secret', async () => {
  const body = '{"data":{"attributes":{"eventType":"PING"}}}'
  assertFalse(await isSignatureValid(body, await sign(body, 'wrong-secret'), 'right-secret'))
})

Deno.test('timingSafeEqual returns false for unequal lengths', () => {
  assertFalse(timingSafeEqual('abc', 'abcd'))
})

Deno.test('timingSafeEqual compares equal-length strings', () => {
  assert(timingSafeEqual('deadbeef', 'deadbeef'))
  assertFalse(timingSafeEqual('deadbeef', 'deadbee0'))
})

Deno.test('toHex zero-pads each byte to two chars', () => {
  const buffer = new Uint8Array([0, 15, 255]).buffer
  assertEquals(toHex(buffer), '000fff')
})
