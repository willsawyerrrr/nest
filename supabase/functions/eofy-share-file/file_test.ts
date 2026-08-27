import { assertEquals } from '@std/assert'
import { type EofyShareFileDeps, runEofyShareFile } from './file.ts'

const grant = { householdId: 'h-1', financialYear: 2027 }

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<EofyShareFileDeps> = {}): EofyShareFileDeps {
  return {
    resolveGrant: () => Promise.resolve({ grant }),
    isPathInScope: () => Promise.resolve(true),
    createSignedUrl: () => Promise.resolve('https://storage.example.com/signed'),
    ...overrides,
  }
}

Deno.test('accepts an in-scope path and returns a signed URL', async () => {
  const result = await runEofyShareFile('token', 'receipts', 'h-1/d-1/receipt.pdf', deps())
  assertEquals(result, {
    status: 200,
    body: { url: 'https://storage.example.com/signed', expiresIn: 300 },
  })
})

Deno.test('reports the resolution error and never checks scope', async () => {
  let scopeChecked = false
  const result = await runEofyShareFile(
    'bad-token',
    'receipts',
    'h-1/d-1/receipt.pdf',
    deps({
      resolveGrant: () =>
        Promise.resolve({
          error: { status: 401, message: 'This share link is invalid or has expired.' },
        }),
      isPathInScope: () => {
        scopeChecked = true
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result, {
    status: 401,
    body: { error: 'This share link is invalid or has expired.' },
  })
  assertEquals(scopeChecked, false)
})

Deno.test('rejects a missing bucket', async () => {
  const result = await runEofyShareFile('token', 'nope', 'h-1/d-1/receipt.pdf', deps())
  assertEquals(result.status, 400)
})

Deno.test('rejects a missing or malformed path', async () => {
  assertEquals((await runEofyShareFile('token', 'receipts', '', deps())).status, 400)
  assertEquals((await runEofyShareFile('token', 'receipts', '/h-1/x', deps())).status, 400)
  assertEquals((await runEofyShareFile('token', 'receipts', 'h-1', deps())).status, 400)
  assertEquals(
    (await runEofyShareFile('token', 'receipts', 'h-1/../h-2/x', deps())).status,
    400,
  )
})

Deno.test('rejects a path from another household without querying scope', async () => {
  let scopeChecked = false
  const result = await runEofyShareFile(
    'token',
    'receipts',
    'h-2/d-1/receipt.pdf',
    deps({
      isPathInScope: () => {
        scopeChecked = true
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result, { status: 403, body: { error: 'That file is not part of this share.' } })
  assertEquals(scopeChecked, false)
})

Deno.test('rejects a path from the same household but a different FY (or with no matching row)', async () => {
  const result = await runEofyShareFile(
    'token',
    'payslips',
    'h-1/p-1/slip.pdf',
    deps({ isPathInScope: () => Promise.resolve(false) }),
  )
  assertEquals(result, { status: 403, body: { error: 'That file is not part of this share.' } })
})

Deno.test('reports 404 when Storage cannot sign the (in-scope) path', async () => {
  const result = await runEofyShareFile(
    'token',
    'receipts',
    'h-1/d-1/receipt.pdf',
    deps({ createSignedUrl: () => Promise.resolve(null) }),
  )
  assertEquals(result, { status: 404, body: { error: 'That file could not be found.' } })
})

Deno.test('passes the resolved grant and requested bucket/path to the scope check', async () => {
  let seen: unknown = null
  await runEofyShareFile(
    'token',
    'payslips',
    'h-1/p-1/slip.pdf',
    deps({
      isPathInScope: (bucket, path, grantSeen) => {
        seen = { bucket, path, grantSeen }
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(seen, { bucket: 'payslips', path: 'h-1/p-1/slip.pdf', grantSeen: grant })
})
