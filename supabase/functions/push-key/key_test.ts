import { assertEquals } from '@std/assert'
import { type PushKeyDeps, runPushKey } from './key.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<PushKeyDeps> = {}): PushKeyDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    loadPublicKey: () => Promise.resolve('BJxV-public-key'),
    ...overrides,
  }
}

Deno.test('runPushKey returns the configured public key', async () => {
  const result = await runPushKey(deps())
  assertEquals(result, { status: 200, body: { publicKey: 'BJxV-public-key' } })
})

Deno.test('runPushKey reports push as unavailable when no key is configured', async () => {
  const result = await runPushKey(deps({ loadPublicKey: () => Promise.resolve(null) }))
  assertEquals(result, {
    status: 503,
    body: { error: 'Push notifications are not configured.' },
  })
})

Deno.test('runPushKey treats an empty key as unconfigured', async () => {
  const result = await runPushKey(deps({ loadPublicKey: () => Promise.resolve('') }))
  assertEquals(result.status, 503)
})

Deno.test('runPushKey refuses an unauthenticated caller', async () => {
  const result = await runPushKey(
    deps({
      resolveMember: () =>
        Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
    }),
  )
  assertEquals(result, { status: 401, body: { error: 'Invalid authorization' } })
})

Deno.test('runPushKey does not read the key for an unresolved caller', async () => {
  let reads = 0
  await runPushKey(
    deps({
      resolveMember: () => Promise.resolve({}),
      loadPublicKey: () => {
        reads += 1
        return Promise.resolve('BJxV-public-key')
      },
    }),
  )
  assertEquals(reads, 0)
})
