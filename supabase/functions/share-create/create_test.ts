import { assertEquals } from '@std/assert'
import { runShareCreate, type ShareCreateDeps, shareUrl } from './create.ts'

const minted = { token: 'a'.repeat(64), expiresAt: '2027-01-08T00:00:00Z' }

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<ShareCreateDeps> = {}): ShareCreateDeps {
  return {
    resolveCaller: () => Promise.resolve({}),
    mintGrant: () => Promise.resolve(minted),
    loadResendKey: () => Promise.resolve('re_test_key'),
    sendEmail: () => Promise.resolve(true),
    appUrl: 'https://nest.willsawyerrrr.dev',
    ...overrides,
  }
}

Deno.test('shareUrl joins the app URL and token, trimming a trailing slash', () => {
  assertEquals(
    shareUrl('https://nest.willsawyerrrr.dev', 'abc123'),
    'https://nest.willsawyerrrr.dev/share/eofy/abc123',
  )
  assertEquals(
    shareUrl('https://nest.willsawyerrrr.dev/', 'abc123'),
    'https://nest.willsawyerrrr.dev/share/eofy/abc123',
  )
})

Deno.test('runShareCreate mints and sends via injected deps on the happy path', async () => {
  let sentTo: string | null = null
  const result = await runShareCreate(
    2027,
    'agent@example.com',
    deps({
      sendEmail: (apiKey, email) => {
        sentTo = email.to
        return Promise.resolve(apiKey === 're_test_key')
      },
    }),
  )
  assertEquals(result, {
    status: 200,
    body: { token: minted.token, expiresAt: minted.expiresAt, emailSent: true },
  })
  assertEquals(sentTo, 'agent@example.com')
})

Deno.test('runShareCreate rejects a missing financial year or recipient email before resolving the caller', async () => {
  let resolved = false
  const withGate = deps({
    resolveCaller: () => {
      resolved = true
      return Promise.resolve({})
    },
  })
  assertEquals((await runShareCreate(null, 'agent@example.com', withGate)).status, 400)
  assertEquals((await runShareCreate(2027, '', withGate)).status, 400)
  assertEquals((await runShareCreate(2027, '   ', withGate)).status, 400)
  assertEquals(resolved, false)
})

Deno.test('runShareCreate reports a caller-resolution error and never mints', async () => {
  let minted = false
  const result = await runShareCreate(
    2027,
    'agent@example.com',
    deps({
      resolveCaller: () =>
        Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
      mintGrant: () => {
        minted = true
        return Promise.resolve({ token: 'x', expiresAt: 'y' })
      },
    }),
  )
  assertEquals(result, { status: 401, body: { error: 'Invalid authorization' } })
  assertEquals(minted, false)
})

Deno.test('runShareCreate reports a mint error and never touches Resend', async () => {
  let keyLoaded = false
  const result = await runShareCreate(
    2027,
    'agent@example.com',
    deps({
      mintGrant: () =>
        Promise.resolve({ error: { status: 500, message: 'Could not create the share.' } }),
      loadResendKey: () => {
        keyLoaded = true
        return Promise.resolve('re_test_key')
      },
    }),
  )
  assertEquals(result, { status: 500, body: { error: 'Could not create the share.' } })
  assertEquals(keyLoaded, false)
})

Deno.test('runShareCreate reports emailSent: false with the token present on a send failure', async () => {
  const result = await runShareCreate(
    2027,
    'agent@example.com',
    deps({ sendEmail: () => Promise.resolve(false) }),
  )
  assertEquals(result, {
    status: 200,
    body: { token: minted.token, expiresAt: minted.expiresAt, emailSent: false },
  })
})

Deno.test('runShareCreate reports emailSent: false without calling sendEmail when no Resend key is configured', async () => {
  let sent = false
  const result = await runShareCreate(
    2027,
    'agent@example.com',
    deps({
      loadResendKey: () => Promise.resolve(null),
      sendEmail: () => {
        sent = true
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result, {
    status: 200,
    body: { token: minted.token, expiresAt: minted.expiresAt, emailSent: false },
  })
  assertEquals(sent, false)
})
