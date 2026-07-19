/**
 * Distinguishes the sync's cron caller from a member's manual refresh by the
 * bearer JWT's `role` claim. The function gateway (verify_jwt=true) has already
 * validated the token's signature before the handler runs, so this only reads
 * the claim — it never re-verifies. Kept in a server-free module so it can be
 * unit-tested without starting the function.
 */

/**
 * Reports whether the bearer is a `service_role` JWT (the cron caller).
 *
 * Base64url-decodes and parses the JWT payload segment and checks its `role`
 * claim. Any malformed or non-JWT input returns false, so an unrecognised
 * bearer falls through to the scoped user path rather than the cron path.
 */
export function isServiceRoleToken(bearer: string): boolean {
  try {
    const payload = bearer.split('.')[1]
    const json = new TextDecoder().decode(decodeBase64Url(payload))
    return (JSON.parse(json) as { role?: unknown }).role === 'service_role'
  } catch {
    return false
  }
}

/** Decodes a base64url segment (no padding, `-`/`_` alphabet) to bytes. */
function decodeBase64Url(segment: string): Uint8Array {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
