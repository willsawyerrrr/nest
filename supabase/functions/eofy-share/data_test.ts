import { assertEquals } from '@std/assert'
import { type EofyShareDeps, type EofyShareRows, normaliseToken, runEofyShare } from './data.ts'

function emptyRows(): EofyShareRows {
  return {
    members: [],
    inflows: [],
    taxProfiles: [],
    superContributions: [],
    superProfiles: [],
    helpDebts: [],
    deductions: [],
    deductionReceipts: [],
    payslips: [],
  }
}

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<EofyShareDeps> = {}): EofyShareDeps {
  return {
    resolveGrant: () => Promise.resolve({ grant: { householdId: 'h-1', financialYear: 2027 } }),
    loadRows: () => Promise.resolve(emptyRows()),
    ...overrides,
  }
}

Deno.test('normaliseToken trims strings and rejects non-strings', () => {
  assertEquals(normaliseToken('  abc  '), 'abc')
  assertEquals(normaliseToken(undefined), '')
  assertEquals(normaliseToken(42), '')
})

Deno.test('runEofyShare shapes the resolved rows with the grant financial year', async () => {
  const rows = { ...emptyRows(), members: [{ id: 'm-1', name: 'Alex' }] }
  const result = await runEofyShare('a-token', deps({ loadRows: () => Promise.resolve(rows) }))
  assertEquals(result, { status: 200, body: { financialYear: 2027, ...rows } })
})

Deno.test('runEofyShare reports the resolution error and never loads rows', async () => {
  let loaded = false
  const result = await runEofyShare(
    'bad-token',
    deps({
      resolveGrant: () =>
        Promise.resolve({
          error: { status: 401, message: 'This share link is invalid or has expired.' },
        }),
      loadRows: () => {
        loaded = true
        return Promise.resolve(emptyRows())
      },
    }),
  )
  assertEquals(result, {
    status: 401,
    body: { error: 'This share link is invalid or has expired.' },
  })
  assertEquals(loaded, false)
})

Deno.test('runEofyShare passes the trimmed token to resolveGrant', async () => {
  let seen: string | null = null
  await runEofyShare(
    '  spaced-token  ',
    deps({
      resolveGrant: (token) => {
        seen = token
        return Promise.resolve({ grant: { householdId: 'h-1', financialYear: 2027 } })
      },
    }),
  )
  assertEquals(seen, 'spaced-token')
})

Deno.test('runEofyShare passes the resolved grant to loadRows', async () => {
  let seenGrant: unknown = null
  await runEofyShare(
    'a-token',
    deps({
      resolveGrant: () => Promise.resolve({ grant: { householdId: 'h-9', financialYear: 2025 } }),
      loadRows: (grant) => {
        seenGrant = grant
        return Promise.resolve(emptyRows())
      },
    }),
  )
  assertEquals(seenGrant, { householdId: 'h-9', financialYear: 2025 })
})
