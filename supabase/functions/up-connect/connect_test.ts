import { assertEquals } from '@std/assert'
import { type ConnectDeps, normaliseToken, runConnect } from './connect.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<ConnectDeps> = {}): ConnectDeps {
  return {
    validateToken: () => Promise.resolve(true),
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    storeToken: () => Promise.resolve(true),
    registerWebhook: () => Promise.resolve(),
    ...overrides,
  }
}

Deno.test('normaliseToken trims strings and rejects non-strings', () => {
  assertEquals(normaliseToken('  up:yeah  '), 'up:yeah')
  assertEquals(normaliseToken(''), '')
  assertEquals(normaliseToken(undefined), '')
  assertEquals(normaliseToken(42), '')
})

Deno.test('runConnect stores the trimmed token and reports connected', async () => {
  const stored: [string, string][] = []
  const result = await runConnect(
    '  up:tok  ',
    deps({
      storeToken: (id, token) => {
        stored.push([id, token])
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { connected: true } })
  assertEquals(stored, [['m-1', 'up:tok']])
})

Deno.test('runConnect rejects a missing token before any I/O', async () => {
  let validated = false
  const result = await runConnect(
    '',
    deps({
      validateToken: () => {
        validated = true
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result.status, 400)
  assertEquals(validated, false)
})

Deno.test('runConnect rejects an invalid token and never resolves a member', async () => {
  let resolved = false
  const result = await runConnect(
    'bad',
    deps({
      validateToken: () => Promise.resolve(false),
      resolveMember: () => {
        resolved = true
        return Promise.resolve({ memberId: 'm-1' })
      },
    }),
  )

  assertEquals(result.status, 400)
  assertEquals(resolved, false)
})

Deno.test('runConnect surfaces a member-resolution error', async () => {
  const result = await runConnect(
    'tok',
    deps({ resolveMember: () => Promise.resolve({ error: { status: 401, message: 'nope' } }) }),
  )

  assertEquals(result, { status: 401, body: { error: 'nope' } })
})

Deno.test('runConnect reports a store failure', async () => {
  const result = await runConnect('tok', deps({ storeToken: () => Promise.resolve(false) }))
  assertEquals(result.status, 500)
})

Deno.test('runConnect registers the webhook once the token is stored', async () => {
  const order: string[] = []
  const result = await runConnect(
    'up:tok',
    deps({
      storeToken: () => {
        order.push('store')
        return Promise.resolve(true)
      },
      registerWebhook: (id, token) => {
        order.push(`register ${id} ${token}`)
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result.status, 200)
  assertEquals(order, ['store', 'register m-1 up:tok'])
})

Deno.test('runConnect stays connected when webhook registration fails', async () => {
  const result = await runConnect(
    'up:tok',
    deps({ registerWebhook: () => Promise.reject(new Error('Up down')) }),
  )
  assertEquals(result, { status: 200, body: { connected: true } })
})

Deno.test('runConnect never registers a webhook when the store fails', async () => {
  let registered = false
  const result = await runConnect(
    'up:tok',
    deps({
      storeToken: () => Promise.resolve(false),
      registerWebhook: () => {
        registered = true
        return Promise.resolve()
      },
    }),
  )
  assertEquals(result.status, 500)
  assertEquals(registered, false)
})
