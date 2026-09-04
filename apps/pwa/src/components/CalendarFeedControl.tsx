import { useState } from 'react'
import { Button, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'
import type { CalendarFeedRow } from '../hooks/useCalendarFeed'
import { calendarFeedUrls } from '../lib/calendarFeed'
import { AppCard } from './AppCard'

interface CalendarFeedControlProps {
  /** The household's live feed row, or null when none has been generated. */
  status: CalendarFeedRow | null
  /** Mints (or replaces) the feed token, returning the plaintext token shown once. */
  onCreate: () => Promise<string>
  onRevoke: () => Promise<void>
}

/**
 * Generates, shows, and revokes the household's calendar-feed subscription URL.
 * The plaintext token is never stored — only its hash — so the URL is shown
 * once, right after `onCreate` returns it, the same "returned once" treatment as
 * the EOFY share link; a page revisit still shows the feed as active (from
 * `status`) but offers no copy button, since the app cannot recover a URL it
 * never kept. Regenerate mints a fresh token, which stops the previous URL
 * resolving.
 */
export function CalendarFeedControl({ status, onCreate, onRevoke }: CalendarFeedControlProps) {
  const [busy, setBusy] = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const active = status !== null || justCreated !== null
  const urls = justCreated ? calendarFeedUrls(justCreated) : null

  const create = async () => {
    setBusy(true)
    try {
      setJustCreated(await onCreate())
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      await onRevoke()
      setJustCreated(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppCard>
      <Stack gap="md">
        <Title order={3} size="h5">
          Calendar feed
        </Title>

        {active ? (
          <Stack gap="xs">
            <Text size="sm">Active</Text>
            {urls ? (
              <Stack gap="xs">
                <Group gap="xs" wrap="wrap">
                  <Code fz="xs">{urls.https}</Code>
                  <CopyButton value={urls.https}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" onClick={copy}>
                        {copied ? 'Copied' : 'Copy URL'}
                      </Button>
                    )}
                  </CopyButton>
                  <CopyButton value={urls.webcal}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" onClick={copy}>
                        {copied ? 'Copied' : 'Copy webcal://'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <Text size="sm" c="dimmed">
                  In your calendar app, choose "Subscribe from URL" (Google Calendar) or "Add
                  calendar subscription" (Apple Calendar) and paste this link.
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                The subscription URL is shown only once. Regenerate to get a new one — the previous
                link stops working.
              </Text>
            )}
            <Group gap="xs">
              <Button size="xs" variant="light" loading={busy} onClick={() => void create()}>
                Regenerate
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={busy}
                onClick={() => void revoke()}
              >
                Revoke
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Generate a private link that adds your household's money dates — expected pay,
              savings-goal and temporary-item targets, and the financial-year boundary — to any
              calendar app as a read-only subscription.
            </Text>
            <Button variant="light" loading={busy} onClick={() => void create()}>
              Generate calendar feed
            </Button>
          </Stack>
        )}
      </Stack>
    </AppCard>
  )
}
