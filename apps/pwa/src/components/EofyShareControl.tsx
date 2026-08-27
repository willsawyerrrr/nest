import { useState } from 'react'
import { Button, Code, CopyButton, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import type { CreatedShare, ShareGrantRow } from '../hooks/useShareGrant'
import { AppCard } from './AppCard'
import { FinancialYearSelect } from './FinancialYearSelect'

/** Describes when a live share lapses, e.g. "Expires in 3 days". */
function expiryLabel(expiresAt: string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now()
  const days = Math.ceil(msLeft / 86_400_000)
  if (days <= 1) {
    return 'Expires within a day'
  }
  return `Expires in ${days} days`
}

interface EofyShareControlProps {
  /** The household's live share, or null when none is active. */
  status: ShareGrantRow | null
  /** The EOFY tab's currently-selected financial year, the create form's default. */
  financialYear: number
  availableFinancialYears: readonly number[]
  onCreate: (financialYear: number, recipientEmail: string) => Promise<CreatedShare>
  onRevoke: () => Promise<void>
}

/**
 * Creates, shows, and revokes the household's single live EOFY share link for
 * a tax agent. The plaintext link is never stored server-side — only its
 * hash — so it is shown once, right after `onCreate` returns it, the same
 * "returned once" treatment as the VAPID/push keys; a page revisit still shows
 * the share as active (from `status`) but offers no Copy Link, since the app
 * itself cannot recover a link it never kept.
 *
 * The "active" view reads from `status` (the loaded share) and `justCreated`
 * (this instance's own freshly minted one) independently, rather than nesting
 * the copy-link block inside `status` alone: `onCreate` already reloads
 * `status` before resolving, so in practice both update together, but reading
 * them independently means the copy-link never depends on that timing.
 */
export function EofyShareControl({
  status,
  financialYear,
  availableFinancialYears,
  onCreate,
  onRevoke,
}: EofyShareControlProps) {
  const [formFinancialYear, setFormFinancialYear] = useState(financialYear)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [justCreated, setJustCreated] = useState<CreatedShare | null>(null)

  const active = status !== null || justCreated !== null
  const expiresAt = status?.expires_at ?? justCreated?.expiresAt ?? null
  const shareUrl = justCreated ? `${window.location.origin}/share/eofy/${justCreated.token}` : null

  const create = async () => {
    setBusy(true)
    try {
      const created = await onCreate(formFinancialYear, email.trim())
      setJustCreated(created)
      setEmail('')
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
          Share with your tax agent
        </Title>

        {active ? (
          <Stack gap="xs">
            {expiresAt && (
              <Group gap="xs" wrap="wrap">
                <Text size="sm">Active — {expiryLabel(expiresAt)}</Text>
              </Group>
            )}
            {status && (
              <Text size="sm" c="dimmed">
                Shared with {status.recipient_email} for FY{status.financial_year}. These are
                estimates for planning purposes, not a filed tax return.
              </Text>
            )}
            {shareUrl && (
              <Group gap="xs" wrap="wrap">
                <Code fz="xs">{shareUrl}</Code>
                <CopyButton value={shareUrl}>
                  {({ copied, copy }) => (
                    <Button size="xs" variant="light" onClick={copy}>
                      {copied ? 'Copied' : 'Copy link'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            )}
            <Group gap="xs">
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
              Send a read-only, 7-day link to a tax agent with this financial year's EOFY summary.
              Creating a new share replaces any share already active.
            </Text>
            <Group gap="xs" wrap="wrap" align="flex-end">
              <TextInput
                label="Tax agent's email"
                placeholder="agent@example.com"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                style={{ flex: 1, minWidth: 200 }}
              />
              <FinancialYearSelect
                financialYear={formFinancialYear}
                availableFinancialYears={availableFinancialYears}
                onChange={setFormFinancialYear}
              />
            </Group>
            <Button
              variant="light"
              disabled={email.trim() === ''}
              loading={busy}
              onClick={() => void create()}
            >
              Send
            </Button>
          </Stack>
        )}
      </Stack>
    </AppCard>
  )
}
