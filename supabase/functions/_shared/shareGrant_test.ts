import { assertEquals } from '@std/assert'
import { type SupabaseClient } from '@supabase/supabase-js'
import { evaluateShareGrantRow, hashShareToken, resolveShareGrant } from './shareGrant.ts'

// Cross-checked against Postgres: `select encode(sha256(convert_to(
// 'advisor-sharing-test-token', 'UTF8')), 'hex')` returns the same digest, which
// is what proves `hashShareToken` looks up the row `create_share_grant` wrote.
Deno.test('hashShareToken matches the Postgres sha256(convert_to(token, UTF8)) hex digest', async () => {
  assertEquals(
    await hashShareToken('advisor-sharing-test-token'),
    'ed8c6e5100bd1ef20266c20a179ffda912f30f98ba7c94473cf32d06e3f1984d',
  )
})

Deno.test('hashShareToken is deterministic and sensitive to its input', async () => {
  const first = await hashShareToken('token-a')
  const second = await hashShareToken('token-a')
  const third = await hashShareToken('token-b')
  assertEquals(first, second)
  assertEquals(first.length, 64)
  assertEquals(first === third, false)
})

const liveRow = { household_id: 'h-1', financial_year: 2027, expires_at: '2027-01-08T00:00:00Z' }
const now = new Date('2027-01-01T00:00:00Z')

Deno.test('evaluateShareGrantRow resolves a live grant', () => {
  assertEquals(evaluateShareGrantRow(liveRow, now), {
    grant: { householdId: 'h-1', financialYear: 2027 },
  })
})

Deno.test('evaluateShareGrantRow reports a generic 401 for a missing row (never matched, or revoked)', () => {
  assertEquals(evaluateShareGrantRow(null, now), {
    error: { status: 401, message: 'This share link is invalid or has expired.' },
  })
})

Deno.test('evaluateShareGrantRow reports the identical 401 for an expired row', () => {
  const expired = { ...liveRow, expires_at: '2026-12-31T00:00:00Z' }
  assertEquals(evaluateShareGrantRow(expired, now), {
    error: { status: 401, message: 'This share link is invalid or has expired.' },
  })
})

Deno.test('evaluateShareGrantRow treats a row expiring at exactly now as expired', () => {
  const boundary = { ...liveRow, expires_at: now.toISOString() }
  assertEquals('error' in evaluateShareGrantRow(boundary, now), true)
})

/** A minimal fake of the `.from().select().eq().maybeSingle()` chain `resolveShareGrant` uses. */
function fakeAdmin(
  result: { data: unknown; error: unknown },
  onQuery?: () => void,
): SupabaseClient {
  return {
    from: () => {
      onQuery?.()
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

Deno.test('resolveShareGrant resolves a valid token to its grant', async () => {
  const admin = fakeAdmin({ data: liveRow, error: null })
  const result = await resolveShareGrant(admin, 'advisor-sharing-test-token')
  assertEquals(result, { grant: { householdId: 'h-1', financialYear: 2027 } })
})

Deno.test('resolveShareGrant reports the generic 401 for a revoked (missing) token', async () => {
  const admin = fakeAdmin({ data: null, error: null })
  const result = await resolveShareGrant(admin, 'advisor-sharing-test-token')
  assertEquals(result, {
    error: { status: 401, message: 'This share link is invalid or has expired.' },
  })
})

Deno.test('resolveShareGrant reports the generic 401 for an expired token', async () => {
  const admin = fakeAdmin({ data: { ...liveRow, expires_at: '2020-01-01T00:00:00Z' }, error: null })
  const result = await resolveShareGrant(admin, 'advisor-sharing-test-token')
  assertEquals(result, {
    error: { status: 401, message: 'This share link is invalid or has expired.' },
  })
})

Deno.test('resolveShareGrant reports the generic 401 for a blank token without querying', async () => {
  let queried = false
  const admin = fakeAdmin({ data: liveRow, error: null }, () => {
    queried = true
  })
  const result = await resolveShareGrant(admin, '   ')
  assertEquals(result, {
    error: { status: 401, message: 'This share link is invalid or has expired.' },
  })
  assertEquals(queried, false)
})

Deno.test('resolveShareGrant reports a 500 on a database error', async () => {
  const admin = fakeAdmin({ data: null, error: { message: 'connection reset' } })
  const result = await resolveShareGrant(admin, 'advisor-sharing-test-token')
  assertEquals(result, { error: { status: 500, message: 'Could not resolve the share link.' } })
})
