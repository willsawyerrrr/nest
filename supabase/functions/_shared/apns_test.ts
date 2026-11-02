import { assert, assertEquals, assertRejects } from '@std/assert'
import { decodeBase64Url, encodeBase64 } from '@std/encoding'
import {
  apnsBody,
  type ApnsDevice,
  type ApnsKeys,
  createApnsSender,
  isGone,
  normaliseApnsKeys,
} from './apns.ts'

const PAYLOAD = { title: 'Hello', body: 'World', url: '/gifts' }
const DEVICE: ApnsDevice = { id: 'd-1', token: 'abc123', environment: 'production' }

/** A real `.p8`-shaped PEM and the public key that verifies its signatures. */
async function generatedKeys(): Promise<{ keys: ApnsKeys; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const pem = `-----BEGIN PRIVATE KEY-----\n${
    encodeBase64(der).match(/.{1,64}/g)!.join('\n')
  }\n-----END PRIVATE KEY-----\n`
  return {
    keys: {
      keyId: 'KEY1234567',
      teamId: 'TEAM123456',
      bundleId: 'dev.example.app',
      privateKey: pem,
    },
    publicKey: pair.publicKey,
  }
}

interface Call {
  url: string
  headers: Headers
  body: string
}

function stubFetch(status: number, body = ''): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    })
    return Promise.resolve(new Response(body === '' ? null : body, { status }))
  }
  return { fetchFn, calls }
}

Deno.test('normaliseApnsKeys needs all four secrets and repairs escaped newlines', () => {
  const row = { key_id: ' K ', team_id: 'T', bundle_id: 'b', private_key: 'a\\nb' }
  assertEquals(normaliseApnsKeys(row), {
    keyId: 'K',
    teamId: 'T',
    bundleId: 'b',
    privateKey: 'a\nb',
  })
  assertEquals(normaliseApnsKeys({ ...row, team_id: null }), null)
  assertEquals(normaliseApnsKeys({ ...row, private_key: '  ' }), null)
  assertEquals(normaliseApnsKeys(null), null)
})

Deno.test('apnsBody carries the alert and the url to open', () => {
  assertEquals(JSON.parse(apnsBody(PAYLOAD)), {
    aps: { alert: { title: 'Hello', body: 'World' }, sound: 'default' },
    url: '/gifts',
  })
})

Deno.test('isGone matches 410 and a 400 BadDeviceToken only', () => {
  assert(isGone(410, 'Unregistered'))
  assert(isGone(410, null))
  assert(isGone(400, 'BadDeviceToken'))
  assert(!isGone(400, 'DeviceTokenNotForTopic'))
  assert(!isGone(403, 'InvalidProviderToken'))
  assert(!isGone(429, 'TooManyRequests'))
  assert(!isGone(503, 'ServiceUnavailable'))
})

Deno.test("the sender posts a signed provider token to the token's own host", async () => {
  const { keys, publicKey } = await generatedKeys()
  const { fetchFn, calls } = stubFetch(200)
  const send = await createApnsSender(keys, {
    fetchFn,
    now: () => new Date('2027-01-01T00:00:00Z'),
  })

  assertEquals(await send(DEVICE, PAYLOAD), { delivered: true })
  await send({ ...DEVICE, environment: 'sandbox' }, PAYLOAD)

  assertEquals(calls[0].url, 'https://api.push.apple.com/3/device/abc123')
  assertEquals(calls[1].url, 'https://api.sandbox.push.apple.com/3/device/abc123')
  assertEquals(calls[0].headers.get('apns-topic'), 'dev.example.app')
  assertEquals(calls[0].headers.get('apns-push-type'), 'alert')
  assertEquals(calls[0].body, apnsBody(PAYLOAD))

  const jwt = calls[0].headers.get('authorization')!.replace('bearer ', '')
  const [header, claims, signature] = jwt.split('.')
  const decode = (part: string) => JSON.parse(new TextDecoder().decode(decodeBase64Url(part)))
  assertEquals(decode(header), { alg: 'ES256', kid: 'KEY1234567' })
  assertEquals(decode(claims), { iss: 'TEAM123456', iat: 1_798_761_600 })
  assert(
    await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      decodeBase64Url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    ),
  )
})

Deno.test('the provider token is reused until it nears an hour old', async () => {
  const { keys } = await generatedKeys()
  const { fetchFn, calls } = stubFetch(200)
  let clock = Date.parse('2027-01-01T00:00:00Z')
  const send = await createApnsSender(keys, { fetchFn, now: () => new Date(clock) })

  await send(DEVICE, PAYLOAD)
  clock += 10 * 60 * 1000
  await send(DEVICE, PAYLOAD)
  clock += 45 * 60 * 1000
  await send(DEVICE, PAYLOAD)

  const tokens = calls.map((call) => call.headers.get('authorization'))
  assertEquals(tokens[0], tokens[1])
  assert(tokens[1] !== tokens[2])
})

Deno.test('the sender reports gone for 410 and BadDeviceToken, transient otherwise', async () => {
  const { keys } = await generatedKeys()
  const outcome = async (status: number, reason?: string) => {
    const { fetchFn } = stubFetch(status, reason ? JSON.stringify({ reason }) : '')
    return (await createApnsSender(keys, { fetchFn }))(DEVICE, PAYLOAD)
  }

  assertEquals(await outcome(410, 'Unregistered'), { delivered: false, gone: true })
  assertEquals(await outcome(400, 'BadDeviceToken'), { delivered: false, gone: true })
  assertEquals(await outcome(400, 'PayloadEmpty'), { delivered: false, gone: false })
  assertEquals(await outcome(403, 'InvalidProviderToken'), { delivered: false, gone: false })
  assertEquals(await outcome(500), { delivered: false, gone: false })
})

Deno.test('a network failure resolves as a transient failure', async () => {
  const { keys } = await generatedKeys()
  const fetchFn: typeof fetch = () => Promise.reject(new Error('offline'))
  const send = await createApnsSender(keys, { fetchFn })
  assertEquals(await send(DEVICE, PAYLOAD), { delivered: false, gone: false })
})

Deno.test('a malformed private key fails when the sender is created', async () => {
  const { keys } = await generatedKeys()
  await assertRejects(() => createApnsSender({ ...keys, privateKey: 'not a key' }))
})
