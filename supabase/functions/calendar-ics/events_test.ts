import { assert, assertEquals } from '@std/assert'
import {
  buildCalendar,
  cadenceStep,
  type CalendarInflowRow,
  type CalendarRows,
  deriveEvents,
  escapeIcsText,
  feedWindow,
  financialYearBoundaryEvents,
  foldIcsLine,
  inflowOccurrences,
  serialiseCalendar,
} from './events.ts'

const NOW = new Date('2027-03-15T09:30:00Z')

function inflow(overrides: Partial<CalendarInflowRow> = {}): CalendarInflowRow {
  return {
    id: 'i-1',
    name: 'Salary',
    schedule: 'fortnightly',
    paid_on: null,
    interval_count: null,
    pay_schedule: null,
    pay_interval_count: null,
    starts_on: null,
    ends_on: null,
    ...overrides,
  }
}

function rows(overrides: Partial<CalendarRows> = {}): CalendarRows {
  return {
    householdName: 'Alex & Sam',
    inflows: [],
    savingsGoals: [],
    temporaryItems: [],
    ...overrides,
  }
}

// ── feedWindow ──────────────────────────────────────────────────────────────

Deno.test('feedWindow spans one month back to twelve months forward', () => {
  assertEquals(feedWindow(NOW), { start: '2027-02-15', end: '2028-03-15' })
})

Deno.test('feedWindow clamps the day to a shorter target month', () => {
  assertEquals(feedWindow(new Date('2027-03-31T00:00:00Z')).start, '2027-02-28')
  assertEquals(feedWindow(new Date('2028-02-29T00:00:00Z')).start, '2028-01-29')
})

// ── cadenceStep ─────────────────────────────────────────────────────────────

Deno.test('cadenceStep maps every fixed frequency', () => {
  assertEquals(cadenceStep('weekly', null), { unit: 'day', count: 7 })
  assertEquals(cadenceStep('fortnightly', null), { unit: 'day', count: 14 })
  assertEquals(cadenceStep('monthly', null), { unit: 'month', count: 1 })
  assertEquals(cadenceStep('quarterly', null), { unit: 'month', count: 3 })
  assertEquals(cadenceStep('biannual', null), { unit: 'month', count: 6 })
  assertEquals(cadenceStep('annual', null), { unit: 'month', count: 12 })
})

Deno.test('cadenceStep resolves the arbitrary cadences from their interval, or null without one', () => {
  assertEquals(cadenceStep('every_n_weeks', 3), { unit: 'day', count: 21 })
  assertEquals(cadenceStep('every_n_months', 2), { unit: 'month', count: 2 })
  assertEquals(cadenceStep('every_n_weeks', null), null)
  assertEquals(cadenceStep('every_n_weeks', 0), null)
  assertEquals(cadenceStep('every_n_months', 1.5), null)
})

// ── inflowOccurrences ───────────────────────────────────────────────────────

const WINDOW = feedWindow(NOW)

Deno.test('inflowOccurrences steps a fortnightly inflow from starts_on, inside the window', () => {
  const dates = inflowOccurrences(inflow({ starts_on: '2027-03-01' }), WINDOW)
  assertEquals(dates[0], '2027-03-01')
  assertEquals(dates[1], '2027-03-15')
  for (const date of dates) {
    assert(date >= WINDOW.start && date <= WINDOW.end)
  }
})

Deno.test('inflowOccurrences anchors an inflow with no starts_on to a fixed epoch, stable across windows', () => {
  const a = inflowOccurrences(inflow({ schedule: 'weekly' }), WINDOW)
  const shifted = feedWindow(new Date('2027-03-16T09:30:00Z'))
  const b = inflowOccurrences(inflow({ schedule: 'weekly' }), shifted)
  // Every date in both windows agrees — the anchor never moved with `now`.
  const overlap = a.filter((date) => date >= shifted.start && date <= b[b.length - 1])
  assertEquals(overlap, b.filter((date) => date <= a[a.length - 1]))
  // Anchored on 2020-07-01: every occurrence is a whole number of weeks from it.
  for (const date of a) {
    assertEquals(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse('2020-07-01T00:00:00Z')) % (7 * 86_400_000),
      0,
    )
  }
})

Deno.test('inflowOccurrences clips at ends_on and yields nothing when the window is outside the active range', () => {
  const clipped = inflowOccurrences(inflow({ schedule: 'weekly', ends_on: '2027-03-20' }), WINDOW)
  assert(clipped.every((date) => date <= '2027-03-20'))
  assertEquals(inflowOccurrences(inflow({ starts_on: '2030-01-01' }), WINDOW), [])
  assertEquals(inflowOccurrences(inflow({ schedule: 'weekly', ends_on: '2020-01-01' }), WINDOW), [])
})

Deno.test('inflowOccurrences prefers the pay cadence and bails on an unusable one', () => {
  // pay_schedule weekly overrides the monthly amount schedule.
  const weekly = inflowOccurrences(
    inflow({ schedule: 'monthly', pay_schedule: 'weekly', starts_on: '2027-03-01' }),
    WINDOW,
  )
  assertEquals(weekly.slice(0, 3), ['2027-03-01', '2027-03-08', '2027-03-15'])
  assertEquals(inflowOccurrences(inflow({ schedule: null, pay_schedule: null }), WINDOW), [])
  assertEquals(
    inflowOccurrences(inflow({ schedule: 'every_n_weeks', interval_count: null }), WINDOW),
    [],
  )
})

Deno.test('inflowOccurrences treats an invalid starts_on as absent', () => {
  const dates = inflowOccurrences(inflow({ schedule: 'weekly', starts_on: 'not-a-date' }), WINDOW)
  assert(dates.length > 0)
  for (const date of dates) {
    assertEquals(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse('2020-07-01T00:00:00Z')) % (7 * 86_400_000),
      0,
    )
  }
})

Deno.test('inflowOccurrences steps monthly cadences by calendar months', () => {
  const dates = inflowOccurrences(
    inflow({ schedule: 'monthly', starts_on: '2027-01-31' }),
    WINDOW,
  )
  // 31 Jan clamps into 28 Feb, and each step advances a calendar month from there.
  assertEquals(dates[0], '2027-02-28')
  assertEquals(dates[1], '2027-03-28')
})

// ── financialYearBoundaryEvents ─────────────────────────────────────────────

Deno.test('financialYearBoundaryEvents emits 30 June and 1 July inside the window', () => {
  assertEquals(financialYearBoundaryEvents(WINDOW), [
    { uid: 'fy-end-2027@nest', date: '2027-06-30', summary: 'FY2027 ends' },
    {
      uid: 'fy-start-2028@nest',
      date: '2027-07-01',
      summary: 'FY2028 begins — review tax settings',
    },
  ])
})

Deno.test('financialYearBoundaryEvents is empty when the window spans no boundary', () => {
  assertEquals(financialYearBoundaryEvents({ start: '2027-08-01', end: '2027-12-01' }), [])
})

// ── deriveEvents ────────────────────────────────────────────────────────────

Deno.test('deriveEvents places a one-off inflow on paid_on only when it is a valid in-window date', () => {
  assertEquals(
    deriveEvents(rows({ inflows: [inflow({ id: 'o-1', paid_on: '2027-05-01' })] }), NOW).find((e) =>
      e.uid === 'inflow-o-1-2027-05-01@nest'
    ),
    { uid: 'inflow-o-1-2027-05-01@nest', date: '2027-05-01', summary: 'Salary' },
  )
  assertEquals(
    deriveEvents(rows({ inflows: [inflow({ paid_on: '2030-01-01' })] }), NOW).some((e) =>
      e.uid.startsWith('inflow-')
    ),
    false,
  )
  assertEquals(
    deriveEvents(rows({ inflows: [inflow({ paid_on: 'nope' })] }), NOW).some((e) =>
      e.uid.startsWith('inflow-')
    ),
    false,
  )
})

Deno.test('deriveEvents turns dated goals and temporary items into one event each', () => {
  const events = deriveEvents(
    rows({
      savingsGoals: [
        { id: 'g-1', name: 'House deposit', target_date: '2027-09-01' },
        { id: 'g-2', name: 'No date', target_date: null },
        { id: 'g-3', name: 'Too far', target_date: '2030-01-01' },
      ],
      temporaryItems: [{ id: 't-1', name: 'Car service fund', target_date: '2027-06-01' }],
    }),
    NOW,
  )
  assert(
    events.some((e) =>
      e.uid === 'goal-g-1-2027-09-01@nest' && e.summary === 'House deposit — savings goal target'
    ),
  )
  assertEquals(events.some((e) => e.uid.startsWith('goal-g-2')), false)
  assertEquals(events.some((e) => e.uid.startsWith('goal-g-3')), false)
  assert(
    events.some((e) =>
      e.uid === 'temp-item-t-1-2027-06-01@nest' && e.summary === 'Car service fund — ends'
    ),
  )
})

Deno.test('deriveEvents is deterministic and always carries the FY boundary events', () => {
  const input = rows({ inflows: [inflow({ starts_on: '2027-03-01' })] })
  assertEquals(deriveEvents(input, NOW), deriveEvents(input, NOW))
  assert(deriveEvents(input, NOW).some((e) => e.uid === 'fy-end-2027@nest'))
})

// ── escapeIcsText ───────────────────────────────────────────────────────────

Deno.test('escapeIcsText escapes backslash, semicolon, comma, and every newline form', () => {
  assertEquals(escapeIcsText('a\\b;c,d'), 'a\\\\b\\;c\\,d')
  assertEquals(escapeIcsText('line1\r\nline2\rline3\nline4'), 'line1\\nline2\\nline3\\nline4')
})

// ── foldIcsLine ─────────────────────────────────────────────────────────────

Deno.test('foldIcsLine leaves a short line alone', () => {
  assertEquals(foldIcsLine('SUMMARY:short'), 'SUMMARY:short')
})

Deno.test('foldIcsLine breaks a long ASCII line into <=75-octet pieces with a leading space', () => {
  const line = 'UID:' + 'x'.repeat(200)
  const folded = foldIcsLine(line)
  const pieces = folded.split('\r\n')
  assert(pieces.length > 1)
  assertEquals(pieces[0].length, 75)
  for (const piece of pieces.slice(1)) {
    assert(piece.startsWith(' '))
    assert(new TextEncoder().encode(piece).length <= 75)
  }
  assertEquals(pieces.map((p, i) => (i === 0 ? p : p.slice(1))).join(''), line)
})

Deno.test('foldIcsLine never splits a multi-byte character across a fold', () => {
  const line = 'SUMMARY:' + '\u{1F4B0}'.repeat(40) // each emoji is 4 UTF-8 bytes
  for (const piece of foldIcsLine(line).split('\r\n')) {
    // A clean decode round-trip proves no continuation byte was orphaned.
    const bytes = new TextEncoder().encode(piece)
    assertEquals(new TextDecoder('utf-8', { fatal: true }).decode(bytes), piece)
  }
})

// ── serialiseCalendar / buildCalendar ───────────────────────────────────────

Deno.test('serialiseCalendar wraps events in a CRLF VCALENDAR envelope with all-day dates', () => {
  const ics = serialiseCalendar(
    [{ uid: 'e-1@nest', date: '2027-06-30', summary: 'Financial year ends' }],
    'Test money dates',
    NOW,
  )
  assert(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert(ics.endsWith('END:VCALENDAR\r\n'))
  assert(ics.includes('\r\nX-WR-CALNAME:Test money dates\r\n'))
  assert(ics.includes('\r\nBEGIN:VEVENT\r\nUID:e-1@nest\r\n'))
  assert(ics.includes('DTSTART;VALUE=DATE:20270630\r\n'))
  assert(ics.includes('DTEND;VALUE=DATE:20270701\r\n'))
  assert(ics.includes('DTSTAMP:20270315T093000Z\r\n'))
})

Deno.test('buildCalendar names the calendar after the household and lists its dates', () => {
  const ics = buildCalendar(
    rows({ inflows: [inflow({ id: 'i-9', paid_on: '2027-04-10' })] }),
    NOW,
  )
  assert(ics.includes('X-WR-CALNAME:Alex & Sam money dates'))
  assert(ics.includes('UID:inflow-i-9-2027-04-10@nest'))
  assert(ics.includes('UID:fy-end-2027@nest'))
})
