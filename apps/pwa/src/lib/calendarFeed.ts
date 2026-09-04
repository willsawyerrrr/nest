/** The `https://` subscription URL and its `webcal://` twin, for one plaintext token. */
export interface CalendarFeedUrls {
  https: string
  webcal: string
}

/**
 * Builds the feed URLs for a token: the `calendar-ics` edge function endpoint
 * with the token as a query parameter, and the same URL under the `webcal://`
 * scheme, which most calendar apps register as "subscribe".
 */
export function calendarFeedUrls(token: string): CalendarFeedUrls {
  const base = import.meta.env.VITE_SUPABASE_URL
  const https = `${base}/functions/v1/calendar-ics?token=${encodeURIComponent(token)}`
  return { https, webcal: https.replace(/^https:\/\//, 'webcal://') }
}
