import { assert, assertFalse } from '@std/assert'
import { isServiceRoleToken } from './auth.ts'

/** Base64url-encodes a string the way a JWT segment is encoded (no padding). */
function base64Url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Builds a JWT with the given payload; the signature is a dummy (unverified). */
function jwt(payload: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  return `${header}.${base64Url(JSON.stringify(payload))}.signature`
}

Deno.test('isServiceRoleToken accepts a service_role JWT', () => {
  assert(isServiceRoleToken(jwt({ role: 'service_role' })))
})

Deno.test('isServiceRoleToken rejects an authenticated user JWT', () => {
  assertFalse(isServiceRoleToken(jwt({ role: 'authenticated', sub: 'user-1' })))
})

Deno.test('isServiceRoleToken rejects a garbage non-JWT string', () => {
  assertFalse(isServiceRoleToken('not-a-jwt'))
})

Deno.test('isServiceRoleToken rejects an empty bearer', () => {
  assertFalse(isServiceRoleToken(''))
})
