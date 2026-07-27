import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import * as webpush from '@negrel/webpush'
import { decodeBase64Url, encodeBase64Url } from '@std/encoding/base64url'
import type { VapidKeys } from '../_shared/vapid.ts'
import { createSender, isGone, vapidJwkFromRaw } from './webpush.ts'
import type { PushDevice } from './send.ts'

const encoder = new TextEncoder()

/** A real VAPID keypair in the stored base64url form. */
async function storedVapidKeys(): Promise<VapidKeys> {
  const pair = await webpush.generateVapidKeys({ extractable: true })
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return {
    publicKey: encodeBase64Url(new Uint8Array(raw)),
    privateKey: jwk.d!,
    subject: 'mailto:ops@example.com',
  }
}

/** A device whose keys are a real ECDH peer, so encryption has somewhere to go. */
async function subscribedDevice(id = 'd-1'): Promise<PushDevice> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ])
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return {
    id,
    endpoint: 'https://push.example/subscription/abc',
    p256dh: encodeBase64Url(new Uint8Array(raw)),
    auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  }
}

/** Swap in a fetch that records the push and answers with `status`. */
function stubFetch(status: number): { calls: Request[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: Request[] = []
  globalThis.fetch = (input, init) => {
    calls.push(new Request(input as string | URL | Request, init))
    return Promise.resolve(new Response(null, { status }))
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

Deno.test('vapidJwkFromRaw splits the stored keypair into a JWK pair', async () => {
  const keys = await storedVapidKeys()
  const jwk = vapidJwkFromRaw(keys)

  assertEquals(jwk.publicKey.kty, 'EC')
  assertEquals(jwk.publicKey.crv, 'P-256')
  assertEquals(jwk.privateKey.d, keys.privateKey)
  // X and Y are the halves of the uncompressed point after its 0x04 tag.
  const point = decodeBase64Url(keys.publicKey)
  assertEquals(jwk.publicKey.x, encodeBase64Url(point.subarray(1, 33)))
  assertEquals(jwk.publicKey.y, encodeBase64Url(point.subarray(33)))
  assertEquals(jwk.privateKey.x, jwk.publicKey.x)
})

Deno.test('vapidJwkFromRaw round-trips through WebCrypto', async () => {
  const keys = await storedVapidKeys()
  const imported = await webpush.importVapidKeys(vapidJwkFromRaw(keys), { extractable: false })
  const reExported = await crypto.subtle.exportKey('raw', imported.publicKey)
  assertEquals(encodeBase64Url(new Uint8Array(reExported)), keys.publicKey)
})

Deno.test('vapidJwkFromRaw rejects a malformed public key', async () => {
  const keys = await storedVapidKeys()
  assertThrows(
    () => vapidJwkFromRaw({ ...keys, publicKey: encodeBase64Url(new Uint8Array(64)) }),
    Error,
    'vapid_public_key',
  )
  // A 65-byte value that is not an uncompressed point.
  assertThrows(
    () => vapidJwkFromRaw({ ...keys, publicKey: encodeBase64Url(new Uint8Array(65)) }),
    Error,
    'vapid_public_key',
  )
})

Deno.test('vapidJwkFromRaw rejects a malformed private key', async () => {
  const keys = await storedVapidKeys()
  assertThrows(
    () => vapidJwkFromRaw({ ...keys, privateKey: encodeBase64Url(new Uint8Array(31)) }),
    Error,
    'vapid_private_key',
  )
})

Deno.test('createSender posts an aes128gcm push signed with a verifiable VAPID JWT', async () => {
  const keys = await storedVapidKeys()
  const device = await subscribedDevice()
  const stub = stubFetch(201)
  try {
    const send = await createSender(keys)
    assertEquals(await send(device, { title: 'T', body: 'B', url: '/household' }), {
      delivered: true,
    })

    assertEquals(stub.calls.length, 1)
    const request = stub.calls[0]
    assertEquals(request.method, 'POST')
    assertEquals(request.url, device.endpoint)
    assertEquals(request.headers.get('Content-Encoding'), 'aes128gcm')
    assertEquals(request.headers.get('Content-Type'), 'application/octet-stream')
    assertEquals(request.headers.get('Urgency'), 'high')
    assert(Number(request.headers.get('TTL')) > 0, 'a TTL is required by RFC 8030')

    // Authorization is the VAPID scheme: a signed JWT plus the public key.
    const authorization = request.headers.get('Authorization') ?? ''
    const parts = authorization.match(/^vapid t=([\w.-]+), k=([\w-]+)$/)
    assert(parts, `unexpected Authorization header: ${authorization}`)
    assertEquals(parts[2], keys.publicKey)

    const [header, claims, signature] = parts[1].split('.')
    assertEquals(JSON.parse(new TextDecoder().decode(decodeBase64Url(header))), {
      typ: 'JWT',
      alg: 'ES256',
    })
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(claims)))
    assertEquals(payload.sub, keys.subject)
    assertEquals(payload.aud, 'https://push.example')
    assert(payload.exp > Math.round(Date.now() / 1000), 'the JWT must not be pre-expired')

    const { publicKey } = await webpush.importVapidKeys(vapidJwkFromRaw(keys))
    assert(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        decodeBase64Url(signature),
        encoder.encode(`${header}.${claims}`),
      ),
      'the VAPID JWT must verify against the configured public key',
    )

    // RFC 8188 framing: a 16-byte salt, the record size, then the app server's
    // ECDH public key as the keyid — the peer the device derives against.
    const record = new Uint8Array(await request.arrayBuffer())
    assertEquals(record[20], 65, 'the keyid is an uncompressed P-256 point')
    assert(record.length > 21 + 65, 'the record carries ciphertext beyond its header')
    assertEquals(record[21], 0x04)
  } finally {
    stub.restore()
  }
})

Deno.test('createSender reports 404 and 410 as gone, and other failures as transient', async () => {
  const keys = await storedVapidKeys()
  const device = await subscribedDevice()
  const payload = { title: 'T', body: 'B', url: '/household' }

  for (const [status, gone] of [[404, true], [410, true], [500, false], [429, false]] as const) {
    const stub = stubFetch(status)
    try {
      const send = await createSender(keys)
      assertEquals(await send(device, payload), { delivered: false, gone }, `status ${status}`)
    } finally {
      stub.restore()
    }
  }
})

Deno.test('isGone ignores an error that is not a push failure', () => {
  assertEquals(isGone(new Error('socket hang up')), false)
  assertEquals(isGone(undefined), false)
})

Deno.test('createSender rejects a malformed stored keypair before any push', async () => {
  const keys = await storedVapidKeys()
  await assertRejects(
    () => createSender({ ...keys, publicKey: 'not-a-key' }),
    Error,
    'vapid_public_key',
  )
})
