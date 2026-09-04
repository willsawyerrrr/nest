/**
 * Derives a household's money dates as calendar events and serialises them to an
 * RFC 5545 `VCALENDAR`. Pure — the rows come in, the ICS text goes out, no I/O.
 * `feed.ts` orchestrates the token resolution and `index.ts` wires the
 * service-role reads.
 *
 * Every event is all-day (`DTSTART;VALUE=DATE`) and carries a stable,
 * deterministic `UID` — `<kind>-<rowId>-<occurrenceDate>@nest` — so a calendar
 * app re-fetching the feed updates an event in place rather than adding a
 * duplicate. Dates are handled as UTC midnight throughout, the same basis the
 * plan package's pay-period arithmetic uses.
 */

import type { Frequency } from '@nest/plan'

/** How far back and forward the feed lists recurring-inflow occurrences. */
export const WINDOW_MONTHS_BACK = 1
export const WINDOW_MONTHS_FORWARD = 12

/**
 * The anchor a recurring inflow with no `starts_on` is stepped from — a fixed AU
 * financial-year start, never `now`. A projection stores no payday for such an
 * inflow, so the exact day is indicative; anchoring it here rather than on the
 * moving window keeps each occurrence on the same date every fetch, so a
 * calendar updates its events in place instead of duplicating them as the
 * window rolls.
 */
const CADENCE_EPOCH = '2020-07-01'

const MS_PER_DAY = 86_400_000

/** An inflow row, with only the fields the feed reads. */
export interface CalendarInflowRow {
  id: string
  name: string
  /** The period the amount is expressed over; null on a one-off. */
  schedule: Frequency | null
  /** The single date a one-off lands on; null on a recurring inflow. */
  paid_on: string | null
  interval_count: number | null
  /** The cadence the money arrives on; null when it matches `schedule`. */
  pay_schedule: Frequency | null
  pay_interval_count: number | null
  starts_on: string | null
  ends_on: string | null
}

/** A savings goal or temporary item — a name and a single target date. */
export interface CalendarDatedRow {
  id: string
  name: string
  target_date: string | null
}

/** Everything the feed needs, already scoped to one household. */
export interface CalendarRows {
  householdName: string
  inflows: CalendarInflowRow[]
  savingsGoals: CalendarDatedRow[]
  temporaryItems: CalendarDatedRow[]
}

/** One derived all-day event, before serialisation. */
export interface CalendarEvent {
  uid: string
  /** The all-day date, `YYYY-MM-DD`. */
  date: string
  summary: string
}

/** An inclusive date window, both ends `YYYY-MM-DD`. */
export interface DateWindow {
  start: string
  end: string
}

/** Parses `YYYY-MM-DD` as a UTC-midnight epoch. */
function isoToMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

/** Formats a UTC-midnight epoch as `YYYY-MM-DD`. */
function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Whether `iso` is a well-formed `YYYY-MM-DD` calendar date. */
function isValidIso(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(isoToMs(iso))
}

/**
 * `months` whole calendar months after a UTC-midnight epoch, the day clamped to
 * the target month's last day where it is shorter — one month after 31 January
 * is 28 (or 29) February, never a rollover into March.
 */
function addMonths(ms: number, months: number): number {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay))
}

/** The rolling window the feed covers, anchored on `now`. */
export function feedWindow(now: Date): DateWindow {
  const todayMs = isoToMs(now.toISOString().slice(0, 10))
  return {
    start: msToIso(addMonths(todayMs, -WINDOW_MONTHS_BACK)),
    end: msToIso(addMonths(todayMs, WINDOW_MONTHS_FORWARD)),
  }
}

/** One step of a recurrence cadence, in days or whole calendar months. */
type CadenceStep = { unit: 'day'; count: number } | { unit: 'month'; count: number }

/** Whether `count` is a usable positive-integer interval. */
function isUsableInterval(count: number | null): count is number {
  return count !== null && Number.isInteger(count) && count >= 1
}

/**
 * The step one turn of `frequency` advances by, or null when the cadence is not
 * usable — an `every_n_weeks` / `every_n_months` inflow with no positive-integer
 * interval, which no calendar occurrence can be placed from.
 */
export function cadenceStep(
  frequency: Frequency,
  intervalCount: number | null,
): CadenceStep | null {
  switch (frequency) {
    case 'weekly':
      return { unit: 'day', count: 7 }
    case 'fortnightly':
      return { unit: 'day', count: 14 }
    case 'monthly':
      return { unit: 'month', count: 1 }
    case 'quarterly':
      return { unit: 'month', count: 3 }
    case 'biannual':
      return { unit: 'month', count: 6 }
    case 'annual':
      return { unit: 'month', count: 12 }
    case 'every_n_weeks':
      return isUsableInterval(intervalCount) ? { unit: 'day', count: 7 * intervalCount } : null
    case 'every_n_months':
      return isUsableInterval(intervalCount) ? { unit: 'month', count: intervalCount } : null
  }
}

/** `step` applied to a UTC-midnight epoch. */
function advance(ms: number, step: CadenceStep): number {
  return step.unit === 'day' ? ms + step.count * MS_PER_DAY : addMonths(ms, step.count)
}

/**
 * The dates a recurring inflow is expected to deposit within `window`. The
 * cadence is the inflow's PAY cadence where it states one (`pay_schedule` +
 * `pay_interval_count`), the amount's own `schedule` + `interval_count`
 * otherwise — the same precedence a payslip period reads. Occurrences are
 * anchored on `starts_on` when set, otherwise on {@link CADENCE_EPOCH} so the
 * dates stay fixed across fetches. `starts_on` / `ends_on` clip the series at
 * both ends. An inflow with no usable cadence yields nothing.
 */
export function inflowOccurrences(inflow: CalendarInflowRow, window: DateWindow): string[] {
  const frequency = inflow.pay_schedule ?? inflow.schedule
  if (frequency === null) {
    return []
  }
  const intervalCount = inflow.pay_schedule ? inflow.pay_interval_count : inflow.interval_count
  const step = cadenceStep(frequency, intervalCount)
  if (step === null) {
    return []
  }

  const windowStartMs = isoToMs(window.start)
  const windowEndMs = isoToMs(window.end)
  const activeFromMs = inflow.starts_on && isValidIso(inflow.starts_on)
    ? Math.max(windowStartMs, isoToMs(inflow.starts_on))
    : windowStartMs
  const activeUntilMs = inflow.ends_on && isValidIso(inflow.ends_on)
    ? Math.min(windowEndMs, isoToMs(inflow.ends_on))
    : windowEndMs
  if (activeFromMs > activeUntilMs) {
    return []
  }

  const anchorMs = inflow.starts_on && isValidIso(inflow.starts_on)
    ? isoToMs(inflow.starts_on)
    : isoToMs(CADENCE_EPOCH)

  const dates: string[] = []
  let cursorMs = anchorMs
  // Wind forward to the first occurrence at or after the active-from date. The
  // guard bounds a pathological zero-length step; cadenceStep never returns one.
  for (let guard = 0; cursorMs < activeFromMs && guard < 100_000; guard += 1) {
    cursorMs = advance(cursorMs, step)
  }
  for (let guard = 0; cursorMs <= activeUntilMs && guard < 1000; guard += 1) {
    dates.push(msToIso(cursorMs))
    cursorMs = advance(cursorMs, step)
  }
  return dates
}

/** `date` is inside `window`, inclusive. */
function inWindow(date: string, window: DateWindow): boolean {
  return date >= window.start && date <= window.end
}

/**
 * The financial-year boundary events inside `window`: 30 June (an FY ends) and
 * 1 July (the next FY begins — a prompt to review tax settings), for every such
 * date the window spans.
 */
export function financialYearBoundaryEvents(window: DateWindow): CalendarEvent[] {
  const firstYear = Number(window.start.slice(0, 4))
  const lastYear = Number(window.end.slice(0, 4))
  const events: CalendarEvent[] = []
  for (let year = firstYear; year <= lastYear; year += 1) {
    const june30 = `${year}-06-30`
    if (inWindow(june30, window)) {
      events.push({ uid: `fy-end-${year}@nest`, date: june30, summary: `FY${year} ends` })
    }
    const july1 = `${year}-07-01`
    if (inWindow(july1, window)) {
      events.push({
        uid: `fy-start-${year + 1}@nest`,
        date: july1,
        summary: `FY${year + 1} begins — review tax settings`,
      })
    }
  }
  return events
}

/** Every event the feed carries for `rows`, over the window anchored on `now`. */
export function deriveEvents(rows: CalendarRows, now: Date): CalendarEvent[] {
  const window = feedWindow(now)
  const events: CalendarEvent[] = []

  for (const inflow of rows.inflows) {
    if (inflow.paid_on !== null) {
      if (isValidIso(inflow.paid_on) && inWindow(inflow.paid_on, window)) {
        events.push({
          uid: `inflow-${inflow.id}-${inflow.paid_on}@nest`,
          date: inflow.paid_on,
          summary: inflow.name,
        })
      }
      continue
    }
    for (const date of inflowOccurrences(inflow, window)) {
      events.push({ uid: `inflow-${inflow.id}-${date}@nest`, date, summary: inflow.name })
    }
  }

  for (const goal of rows.savingsGoals) {
    if (goal.target_date && isValidIso(goal.target_date) && inWindow(goal.target_date, window)) {
      events.push({
        uid: `goal-${goal.id}-${goal.target_date}@nest`,
        date: goal.target_date,
        summary: `${goal.name} — savings goal target`,
      })
    }
  }

  for (const item of rows.temporaryItems) {
    if (item.target_date && isValidIso(item.target_date) && inWindow(item.target_date, window)) {
      events.push({
        uid: `temp-item-${item.id}-${item.target_date}@nest`,
        date: item.target_date,
        summary: `${item.name} — ends`,
      })
    }
  }

  events.push(...financialYearBoundaryEvents(window))
  return events
}

/** Escapes an RFC 5545 TEXT value: backslash, semicolon, comma, and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Folds a content line to 75 octets per RFC 5545: a CRLF followed by a single
 * space breaks an over-long line, and a multi-byte character is never split
 * across the fold.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) {
    return line
  }
  const out: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of line) {
    const charBytes = encoder.encode(char).length
    // Continuation lines carry a leading space, so their budget is 74 octets.
    const limit = out.length === 0 ? 75 : 74
    if (currentBytes + charBytes > limit) {
      out.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += charBytes
  }
  out.push(current)
  return out.join('\r\n ')
}

/** `Date` as an RFC 5545 UTC timestamp, `YYYYMMDDTHHMMSSZ`. */
function icsTimestamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
}

/** `YYYY-MM-DD` as an RFC 5545 `DATE` value, `YYYYMMDD`. */
function icsDate(iso: string): string {
  return iso.replace(/-/g, '')
}

/**
 * Serialises `events` to a `VCALENDAR`. `now` stamps every event's `DTSTAMP`
 * (when the feed was generated); the stable `UID` is what dedupes a re-fetch.
 * Each event is all-day, `DTEND` the exclusive next day.
 */
export function serialiseCalendar(
  events: CalendarEvent[],
  calendarName: string,
  now: Date,
): string {
  const dtstamp = icsTimestamp(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nest//calendar-feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `NAME:${escapeIcsText(calendarName)}`,
  ]
  for (const event of events) {
    const endMs = isoToMs(event.date) + MS_PER_DAY
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
      `DTEND;VALUE=DATE:${icsDate(msToIso(endMs))}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/** Derives and serialises the whole feed for `rows`. */
export function buildCalendar(rows: CalendarRows, now: Date): string {
  const events = deriveEvents(rows, now)
  return serialiseCalendar(events, `${rows.householdName} money dates`, now)
}
