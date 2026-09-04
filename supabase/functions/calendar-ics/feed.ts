/**
 * The `calendar-ics` request flow, with its I/O injected so the ordering that
 * matters — resolve the token before any table is read — is unit-tested without
 * a network. `index.ts` wires the real token hash, the service-role reads, and
 * the HTTP response.
 *
 * A missing, malformed, or unknown token all return the same bare 404: the feed
 * URL is a bearer credential, so a guessed or stale one learns nothing from the
 * response.
 */

import { buildCalendar, type CalendarRows } from './events.ts'

export interface CalendarIcsResult {
  status: number
  contentType: string
  body: string
}

export interface CalendarIcsDeps {
  /** Resolves a feed token to its household, or null when nothing matches. */
  resolveFeed: (token: string) => Promise<{ householdId: string } | null>
  /** Loads the dated rows for a household, already scoped to it. */
  loadRows: (householdId: string) => Promise<CalendarRows>
}

/** Trims a raw token value to a string, or empty when absent or ill-typed. */
export function normaliseToken(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * The feed token from a request URL: the `?token=` query wins, otherwise the
 * last path segment with any `.ics` suffix trimmed (so both
 * `…/calendar-ics/<token>` and `…/calendar-ics/<token>.ics` resolve). Null when
 * the path carries only the function name.
 */
export function tokenFromRequest(url: URL): string | null {
  const queryToken = url.searchParams.get('token')
  if (queryToken) {
    return queryToken
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments.at(-1)
  if (!last || last === 'calendar-ics') {
    return null
  }
  return last.replace(/\.ics$/i, '')
}

const NOT_FOUND: CalendarIcsResult = {
  status: 404,
  contentType: 'text/plain; charset=utf-8',
  body: 'Calendar feed not found.',
}

export async function runCalendarIcs(
  rawToken: unknown,
  now: Date,
  deps: CalendarIcsDeps,
): Promise<CalendarIcsResult> {
  const token = normaliseToken(rawToken)
  if (!token) {
    return NOT_FOUND
  }

  const feed = await deps.resolveFeed(token)
  if (!feed) {
    return NOT_FOUND
  }

  const rows = await deps.loadRows(feed.householdId)
  return {
    status: 200,
    contentType: 'text/calendar; charset=utf-8',
    body: buildCalendar(rows, now),
  }
}
