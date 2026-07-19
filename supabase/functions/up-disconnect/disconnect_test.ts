import { assertEquals } from '@std/assert'
import { type DisconnectDeps, runDisconnect } from './disconnect.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<DisconnectDeps> = {}): DisconnectDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    clearToken: () => Promise.resolve(true),
    ...overrides,
  }
}

Deno.test('runDisconnect clears the token and reports disconnected', async () => {
  const cleared: string[] = []
  const result = await runDisconnect(
    deps({
      clearToken: (id) => {
        cleared.push(id)
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { connected: false } })
  assertEquals(cleared, ['m-1'])
})

Deno.test('runDisconnect surfaces a member-resolution error', async () => {
  const result = await runDisconnect(
    deps({ resolveMember: () => Promise.resolve({ error: { status: 404, message: 'x' } }) }),
  )

  assertEquals(result, { status: 404, body: { error: 'x' } })
})

Deno.test('runDisconnect reports a clear failure', async () => {
  const result = await runDisconnect(deps({ clearToken: () => Promise.resolve(false) }))
  assertEquals(result.status, 500)
})
