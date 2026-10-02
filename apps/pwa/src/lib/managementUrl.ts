/** Longest management URL the database accepts. */
export const MANAGEMENT_URL_MAX_LENGTH = 2048

/** A bare web address (`netflix.com/account`): dotted host labels, then an optional path, query, or fragment. */
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i

/**
 * Normalises a member-typed management link to a storable http(s) URL, or
 * `null` when it is blank or not one. A bare domain gains `https://`; any other
 * scheme (`javascript:`, `ftp:`) or malformed address is rejected.
 */
export function normaliseManagementUrl(value: string): string | null {
  const trimmed = value.trim()
  const candidate = BARE_DOMAIN.test(trimmed) ? `https://${trimmed}` : trimmed
  if (candidate.length > MANAGEMENT_URL_MAX_LENGTH || /\s/.test(candidate)) {
    return null
  }
  try {
    const { protocol } = new URL(candidate)
    return protocol === 'http:' || protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

/** Whether a management-link field is acceptable: blank (it is optional) or normalisable. */
export function isManagementUrlValid(value: string): boolean {
  return value.trim() === '' || normaliseManagementUrl(value) !== null
}
