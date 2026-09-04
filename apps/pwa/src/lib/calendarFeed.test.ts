import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarFeedUrls } from './calendarFeed'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('calendarFeedUrls', () => {
  it('builds the https endpoint and its webcal:// twin from VITE_SUPABASE_URL', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
    expect(calendarFeedUrls('tok en/1')).toEqual({
      https: 'https://proj.supabase.co/functions/v1/calendar-ics?token=tok%20en%2F1',
      webcal: 'webcal://proj.supabase.co/functions/v1/calendar-ics?token=tok%20en%2F1',
    })
  })
})
