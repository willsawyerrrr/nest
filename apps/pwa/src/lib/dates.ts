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

/** Today's local date as an ISO date (`YYYY-MM-DD`). */
export function todayIso(today: Date = new Date()): string {
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
