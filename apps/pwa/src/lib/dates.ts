const dateFormat = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** Formats an ISO date (`YYYY-MM-DD`) as a short local date (e.g. `28 Feb 2027`). */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  return dateFormat.format(new Date(year, month - 1, day))
}

/**
 * An instant's local calendar date as an ISO date (`YYYY-MM-DD`). A timestamp
 * written in UTC can fall on a different local day, so the date comes from the
 * instant's local fields rather than from its text.
 */
export function isoDate(instant: Date): string {
  const year = instant.getFullYear()
  const month = String(instant.getMonth() + 1).padStart(2, '0')
  const day = String(instant.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Today's local date as an ISO date (`YYYY-MM-DD`). */
export function todayIso(today: Date = new Date()): string {
  return isoDate(today)
}

/**
 * The local ISO date `days` before `iso` — e.g. the first day of a fortnight
 * ending on it, 13 days back. The arithmetic runs on local calendar fields, so a
 * daylight-saving shift cannot land the result on the neighbouring day.
 */
export function isoDaysBefore(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  return isoDate(new Date(year, month - 1, day - days))
}
