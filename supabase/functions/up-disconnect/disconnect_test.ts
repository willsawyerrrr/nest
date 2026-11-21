import { assertEquals } from '@std/assert'
import { type DisconnectDeps, runDisconnect } from './disconnect.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<DisconnectDeps> = {}): DisconnectDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    removeWebhook: () => Promise.resolve(true),
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

Deno.test('runDisconnect removes the webhook before clearing the token', async () => {
  const order: string[] = []
  await runDisconnect(
    deps({
      removeWebhook: (id) => {
        order.push(`webhook ${id}`)
        return Promise.resolve(true)
      },
      clearToken: (id) => {
        order.push(`token ${id}`)
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(order, ['webhook m-1', 'token m-1'])
})

Deno.test('runDisconnect keeps the token when the webhook clear fails', async () => {
  let cleared = false
  const result = await runDisconnect(
    deps({
      removeWebhook: () => Promise.resolve(false),
      clearToken: () => {
        cleared = true
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result.status, 500)
  assertEquals(cleared, false)
})
