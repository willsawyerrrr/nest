import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '../test/render'
import { CalendarFeedControl } from './CalendarFeedControl'

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CalendarFeedControl', () => {
  it('generates a feed and shows the URL and its webcal:// twin once', async () => {
    const onCreate = vi.fn().mockResolvedValue('the-token')
    render(<CalendarFeedControl status={null} onCreate={onCreate} onRevoke={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /generate calendar feed/i }))

    expect(onCreate).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(
        screen.getByText('https://proj.supabase.co/functions/v1/calendar-ics?token=the-token'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy webcal://' })).toBeInTheDocument()
    expect(screen.getByText(/Subscribe from URL/i)).toBeInTheDocument()
  })

  it('copies both the https and webcal:// URLs to the clipboard', async () => {
    const user = userEvent.setup()
    render(
      <CalendarFeedControl
        status={null}
        onCreate={vi.fn().mockResolvedValue('cp')}
        onRevoke={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /generate calendar feed/i }))
    await screen.findByText(/token=cp$/)

    await user.click(screen.getByRole('button', { name: 'Copy URL' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(
      'https://proj.supabase.co/functions/v1/calendar-ics?token=cp',
    )

    await user.click(screen.getByRole('button', { name: 'Copy webcal://' }))
    expect(await navigator.clipboard.readText()).toBe(
      'webcal://proj.supabase.co/functions/v1/calendar-ics?token=cp',
    )
  })

  it('shows an active feed with no URL on a revisit, since the app never kept it', () => {
    render(
      <CalendarFeedControl
        status={{ household_id: 'h1', created_at: '2027-01-01T00:00:00Z' }}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
      />,
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy URL' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  })

  it('regenerates a fresh URL from the active state', async () => {
    const onCreate = vi.fn().mockResolvedValue('fresh-token')
    render(
      <CalendarFeedControl
        status={{ household_id: 'h1', created_at: '2027-01-01T00:00:00Z' }}
        onCreate={onCreate}
        onRevoke={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.getByText(/token=fresh-token/)).toBeInTheDocument())
  })

  it('revokes the feed and drops the just-created URL', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(
      <CalendarFeedControl
        status={null}
        onCreate={vi.fn().mockResolvedValue('t')}
        onRevoke={onRevoke}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /generate calendar feed/i }))
    await waitFor(() => expect(screen.getByText(/token=t$/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(onRevoke).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate calendar feed/i })).toBeInTheDocument(),
    )
  })
})
