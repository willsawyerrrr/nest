import { assert, assertEquals } from '@std/assert'
import type { CalendarRows } from './events.ts'
import { type CalendarIcsDeps, normaliseToken, runCalendarIcs, tokenFromRequest } from './feed.ts'

function emptyRows(): CalendarRows {
  return { householdName: 'Test', inflows: [], savingsGoals: [], temporaryItems: [] }
}

function deps(overrides: Partial<CalendarIcsDeps> = {}): CalendarIcsDeps {
  return {
    resolveFeed: () => Promise.resolve({ householdId: 'h-1' }),
    loadRows: () => Promise.resolve(emptyRows()),
    ...overrides,
  }
}

const NOW = new Date('2027-03-15T09:00:00Z')

Deno.test('normaliseToken trims strings and rejects non-strings', () => {
  assertEquals(normaliseToken('  abc  '), 'abc')
  assertEquals(normaliseToken(undefined), '')
  assertEquals(normaliseToken(42), '')
})

Deno.test('tokenFromRequest reads the query token, then the last path segment', () => {
  assertEquals(
    tokenFromRequest(new URL('https://x.fn/calendar-ics?token=abc123')),
    'abc123',
  )
  assertEquals(tokenFromRequest(new URL('https://x.fn/calendar-ics/abc123')), 'abc123')
  assertEquals(tokenFromRequest(new URL('https://x.fn/calendar-ics/abc123.ics')), 'abc123')
  assertEquals(tokenFromRequest(new URL('https://x.fn/calendar-ics')), null)
})

Deno.test('runCalendarIcs returns a bare 404 for a blank token and never resolves', async () => {
  let resolved = false
  const result = await runCalendarIcs(
    '   ',
    NOW,
    deps({
      resolveFeed: () => {
        resolved = true
        return Promise.resolve({ householdId: 'h-1' })
      },
    }),
  )
  assertEquals(result.status, 404)
  assertEquals(result.contentType, 'text/plain; charset=utf-8')
  assertEquals(resolved, false)
})

Deno.test('runCalendarIcs returns the identical 404 for an unknown token and never loads rows', async () => {
  let loaded = false
  const result = await runCalendarIcs(
    'unknown',
    NOW,
    deps({
      resolveFeed: () => Promise.resolve(null),
      loadRows: () => {
        loaded = true
        return Promise.resolve(emptyRows())
      },
    }),
  )
  assertEquals(result, {
    status: 404,
    contentType: 'text/plain; charset=utf-8',
    body: 'Calendar feed not found.',
  })
  assertEquals(loaded, false)
})

Deno.test('runCalendarIcs serves a text/calendar VCALENDAR envelope for a resolved token', async () => {
  const result = await runCalendarIcs('good-token', NOW, deps())
  assertEquals(result.status, 200)
  assertEquals(result.contentType, 'text/calendar; charset=utf-8')
  assert(result.body.startsWith('BEGIN:VCALENDAR\r\n'))
  assert(result.body.trimEnd().endsWith('END:VCALENDAR'))
  assert(result.body.includes('X-WR-CALNAME:Test money dates'))
  // Even an empty household still gets the financial-year boundary events.
  assert(result.body.includes('BEGIN:VEVENT'))
})

Deno.test('runCalendarIcs passes the resolved household through to loadRows', async () => {
  let seen: string | null = null
  await runCalendarIcs(
    'good-token',
    NOW,
    deps({
      resolveFeed: () => Promise.resolve({ householdId: 'h-42' }),
      loadRows: (householdId) => {
        seen = householdId
        return Promise.resolve(emptyRows())
      },
    }),
  )
  assertEquals(seen, 'h-42')
})
