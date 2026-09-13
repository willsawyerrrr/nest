import { assertEquals } from '@std/assert'
import { type DisconnectDeps, runDisconnect } from './disconnect.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<DisconnectDeps> = {}): DisconnectDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    findConnection: () => Promise.resolve({ memberId: 'm-1' }),
    revokeConnection: () => Promise.resolve(),
    deleteConnection: () => Promise.resolve(true),
    ...overrides,
  }
}

Deno.test('runDisconnect rejects a missing connectionId before any I/O', async () => {
  let resolved = false
  const result = await runDisconnect(
    '',
    deps({
      resolveMember: () => {
        resolved = true
        return Promise.resolve({ memberId: 'm-1' })
      },
    }),
  )

  assertEquals(result.status, 400)
  assertEquals(resolved, false)
})

Deno.test('runDisconnect surfaces a member-resolution error', async () => {
  const result = await runDisconnect(
    'conn-1',
    deps({ resolveMember: () => Promise.resolve({ error: { status: 401, message: 'nope' } }) }),
  )

  assertEquals(result, { status: 401, body: { error: 'nope' } })
})

Deno.test('runDisconnect 404s when the connection does not exist', async () => {
  const result = await runDisconnect(
    'conn-1',
    deps({ findConnection: () => Promise.resolve(null) }),
  )
  assertEquals(result.status, 404)
})

Deno.test('runDisconnect 403s when the connection belongs to another member', async () => {
  let revoked = false
  const result = await runDisconnect(
    'conn-1',
    deps({
      findConnection: () => Promise.resolve({ memberId: 'm-2' }),
      revokeConnection: () => {
        revoked = true
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result.status, 403)
  assertEquals(revoked, false)
})

Deno.test('runDisconnect revokes with Redbark, deletes the row, and reports disconnected', async () => {
  const revoked: string[] = []
  const deleted: string[] = []
  const result = await runDisconnect(
    'conn-1',
    deps({
      revokeConnection: (id) => {
        revoked.push(id)
        return Promise.resolve()
      },
      deleteConnection: (id) => {
        deleted.push(id)
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { connected: false } })
  assertEquals(revoked, ['conn-1'])
  assertEquals(deleted, ['conn-1'])
})

Deno.test('runDisconnect reports a Redbark revoke failure as a 502 and deletes nothing', async () => {
  let deleted = false
  const result = await runDisconnect(
    'conn-1',
    deps({
      revokeConnection: () =>
        Promise.reject(new Error('Redbark API 500 for /connections/conn-1: boom')),
      deleteConnection: () => {
        deleted = true
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result.status, 502)
  assertEquals(deleted, false)
})

Deno.test('runDisconnect reports a delete failure', async () => {
  const result = await runDisconnect(
    'conn-1',
    deps({ deleteConnection: () => Promise.resolve(false) }),
  )
  assertEquals(result.status, 500)
})
