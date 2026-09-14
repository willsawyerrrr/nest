import { assertEquals } from '@std/assert'
import { type CompleteDeps, normaliseLinkSessionId, runComplete } from './complete.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<CompleteDeps> = {}): CompleteDeps {
  return {
    resolveCaller: () => Promise.resolve({ memberId: 'm-1', householdId: 'h-1' }),
    getLinkSession: () =>
      Promise.resolve({ status: 'completed', connection: 'conn-1', failure_reason: null }),
    getConnection: () => Promise.resolve({ status: 'active', institutionName: 'Big Bank' }),
    upsertConnection: () => Promise.resolve(true),
    ...overrides,
  }
}

Deno.test('normaliseLinkSessionId trims strings and rejects non-strings', () => {
  assertEquals(normaliseLinkSessionId('  sess-1  '), 'sess-1')
  assertEquals(normaliseLinkSessionId(''), '')
  assertEquals(normaliseLinkSessionId(undefined), '')
  assertEquals(normaliseLinkSessionId(42), '')
})

Deno.test('runComplete rejects a missing linkSessionId before any I/O', async () => {
  let resolved = false
  const result = await runComplete(
    '',
    deps({
      resolveCaller: () => {
        resolved = true
        return Promise.resolve({ memberId: 'm-1', householdId: 'h-1' })
      },
    }),
  )

  assertEquals(result.status, 400)
  assertEquals(resolved, false)
})

Deno.test('runComplete surfaces a caller-resolution error', async () => {
  const result = await runComplete(
    'sess-1',
    deps({ resolveCaller: () => Promise.resolve({ error: { status: 401, message: 'nope' } }) }),
  )

  assertEquals(result, { status: 401, body: { error: 'nope' } })
})

Deno.test('runComplete reports a pending session without touching the connection', async () => {
  let readConnection = false
  const result = await runComplete(
    'sess-1',
    deps({
      getLinkSession: () =>
        Promise.resolve({ status: 'pending', connection: null, failure_reason: null }),
      getConnection: () => {
        readConnection = true
        return Promise.resolve({ status: 'active', institutionName: 'Big Bank' })
      },
    }),
  )

  assertEquals(result, { status: 200, body: { connected: false, status: 'pending' } })
  assertEquals(readConnection, false)
})

Deno.test('runComplete reports a failed session with its failure reason', async () => {
  const result = await runComplete(
    'sess-1',
    deps({
      getLinkSession: () =>
        Promise.resolve({
          status: 'failed',
          connection: null,
          failure_reason: 'user_cancelled',
        }),
    }),
  )

  assertEquals(result, {
    status: 200,
    body: { connected: false, status: 'failed', reason: 'user_cancelled' },
  })
})

Deno.test('runComplete reports a completed session with no connection id as failed', async () => {
  const result = await runComplete(
    'sess-1',
    deps({
      getLinkSession: () =>
        Promise.resolve({ status: 'completed', connection: null, failure_reason: null }),
    }),
  )

  assertEquals(result, {
    status: 200,
    body: { connected: false, status: 'failed', reason: null },
  })
})

Deno.test('runComplete surfaces a link-session read failure as a 502', async () => {
  const result = await runComplete(
    'sess-1',
    deps({
      getLinkSession: () =>
        Promise.reject(new Error('Redbark API 500 for /link_sessions/sess-1: boom')),
    }),
  )

  assertEquals(result.status, 502)
  assertEquals((result.body.error as string).includes('boom'), true)
})

Deno.test('runComplete surfaces a connection read failure as a 502', async () => {
  const result = await runComplete(
    'sess-1',
    deps({
      getConnection: () =>
        Promise.reject(new Error('Redbark API 500 for /connections/conn-1: boom')),
    }),
  )

  assertEquals(result.status, 502)
})

Deno.test('runComplete upserts the connection under the caller and reports connected', async () => {
  const upserted: unknown[] = []
  const result = await runComplete(
    'sess-1',
    deps({
      upsertConnection: (row) => {
        upserted.push(row)
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { connected: true } })
  assertEquals(upserted, [
    {
      id: 'conn-1',
      householdId: 'h-1',
      memberId: 'm-1',
      institutionName: 'Big Bank',
      status: 'active',
    },
  ])
})

Deno.test('runComplete reports an upsert failure', async () => {
  const result = await runComplete(
    'sess-1',
    deps({ upsertConnection: () => Promise.resolve(false) }),
  )
  assertEquals(result.status, 500)
})
