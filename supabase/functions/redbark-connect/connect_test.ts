import { assertEquals } from '@std/assert'
import { RedbarkApiError } from '../_shared/redbark.ts'
import { type ConnectDeps, normaliseReturnUrl, runConnect } from './connect.ts'

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<ConnectDeps> = {}): ConnectDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    createLinkSession: () => Promise.resolve({ id: 'sess-1', url: 'https://fiskil.test/consent' }),
    ...overrides,
  }
}

Deno.test('normaliseReturnUrl trims strings and rejects non-strings', () => {
  assertEquals(normaliseReturnUrl('  https://nest.test/return  '), 'https://nest.test/return')
  assertEquals(normaliseReturnUrl(''), '')
  assertEquals(normaliseReturnUrl(undefined), '')
  assertEquals(normaliseReturnUrl(42), '')
})

Deno.test('runConnect starts a link session and returns its id and url', async () => {
  const result = await runConnect('https://nest.test/return', deps())

  assertEquals(result, {
    status: 200,
    body: { linkSessionId: 'sess-1', url: 'https://fiskil.test/consent' },
  })
})

Deno.test('runConnect rejects a missing returnUrl before any I/O', async () => {
  let resolved = false
  const result = await runConnect(
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

Deno.test('runConnect surfaces a member-resolution error and never starts a session', async () => {
  let started = false
  const result = await runConnect(
    'https://nest.test/return',
    deps({
      resolveMember: () => Promise.resolve({ error: { status: 401, message: 'nope' } }),
      createLinkSession: () => {
        started = true
        return Promise.resolve({ id: 'sess-1', url: 'https://fiskil.test/consent' })
      },
    }),
  )

  assertEquals(result, { status: 401, body: { error: 'nope' } })
  assertEquals(started, false)
})

function failing(error: Error) {
  return deps({ createLinkSession: () => Promise.reject(error) })
}

Deno.test('runConnect reports a Redbark failure with a stable code and no upstream text', async () => {
  const original = console.error
  console.error = () => {}
  try {
    const result = await runConnect(
      'https://nest.test/return',
      failing(new RedbarkApiError(403, 'plan_upgrade_required', 'req_123 upstream detail')),
    )

    assertEquals(result.status, 503)
    assertEquals(result.body.code, 'plan_upgrade_required')
    assertEquals(JSON.stringify(result.body).includes('req_123'), false)
  } finally {
    console.error = original
  }
})
