import { useState } from 'react'
import { Badge, Button, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'
import type {
  DocumentIntakeTokenStatus,
  MintedDocumentIntakeToken,
} from '../hooks/useDocumentIntakeTokens'
import type { Member } from '../hooks/useMembers'
import { AppCard } from './AppCard'

/** A day-month-year label for an ISO timestamp, e.g. "Active since 1 Sep 2026". */
function activeSinceLabel(iso: string): string {
  const date = new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `Active since ${date}`
}

interface DocumentIntakeTokenCardProps {
  /** The signed-in member, whose row alone carries mint/revoke controls. */
  currentUserId: string
  members: Member[]
  /** Every household member's token status; never the token itself. */
  statuses: DocumentIntakeTokenStatus[]
  busy: boolean
  /** Mints (or replaces) the signed-in member's own token. */
  onCreate: () => Promise<MintedDocumentIntakeToken>
  onRevoke: () => Promise<void>
}

/**
 * The bearer token an iOS Shortcut carries to post a payslip or deduction
 * receipt to `document-intake` from the system share sheet, outside the PWA
 * entirely — see `docs/document-intake.md` for why (App Intents is a
 * native-app-only framework Nest cannot use, and Safari has no Web Share
 * Target API) and how to build the Shortcut itself.
 *
 * The endpoint URL is shown unconditionally — a Shortcut needs it regardless
 * of whether a token exists yet — while the token is the "returned once"
 * treatment `EofyShareControl`/the VAPID keys already use: shown only in the
 * render pass right after `onCreate` resolves, then gone, since the app never
 * stores it. A member acts only on their own row (mint or revoke resolves the
 * caller's own member server-side, with no `member_id` to pass), but every
 * household member's status is visible, exactly as the Up connection's is.
 */
export function DocumentIntakeTokenCard({
  currentUserId,
  members,
  statuses,
  busy,
  onCreate,
  onRevoke,
}: DocumentIntakeTokenCardProps) {
  const [justCreated, setJustCreated] = useState<MintedDocumentIntakeToken | null>(null)
  const me = members.find((member) => member.user_id === currentUserId)
  const myStatus = me ? (statuses.find((status) => status.member_id === me.id) ?? null) : null
  const endpointUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-intake`

  const create = async () => {
    setJustCreated(await onCreate())
  }

  const revoke = async () => {
    await onRevoke()
    setJustCreated(null)
  }

  return (
    <AppCard>
      <Stack gap="md">
        <Title order={3} size="h5">
          Document intake
        </Title>
        <Text size="sm" c="dimmed">
          Share a payslip or receipt to Nest from Mail, Files, or a scan — from outside the app
          entirely — using an iOS Shortcut you build once. It lands in an inbox on the Payslips or
          Deductions tab for you to review before anything is saved.
        </Text>

        <Stack gap={2}>
          <Text size="xs" fw={600}>
            Endpoint
          </Text>
          <Group gap="xs" wrap="wrap">
            <Code fz="xs">{endpointUrl}</Code>
            <CopyButton value={endpointUrl}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Stack>

        {myStatus || justCreated ? (
          <Stack gap="xs">
            {myStatus && (
              <Group gap="xs" wrap="wrap">
                <Badge size="sm" color="green" variant="light">
                  {activeSinceLabel(myStatus.created_at)}
                </Badge>
              </Group>
            )}
            {justCreated && (
              <Stack gap={2}>
                <Text size="xs" fw={600}>
                  Token — paste this into your Shortcut's Authorization header now; it will not be
                  shown again
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Code fz="xs">{justCreated.token}</Code>
                  <CopyButton value={justCreated.token}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" onClick={copy}>
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              </Stack>
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
          <Button variant="light" loading={busy} onClick={() => void create()}>
            Generate token
          </Button>
        )}

        <Stack gap="xxs">
          {members
            .filter((member) => member.id !== me?.id)
            .map((member) => {
              const status = statuses.find((each) => each.member_id === member.id) ?? null
              return (
                <Group key={member.id} justify="space-between">
                  <Text size="sm">{member.name}</Text>
                  <Badge size="sm" variant="light" color={status !== null ? 'green' : 'gray'}>
                    {status !== null ? 'Connected' : 'Not connected'}
                  </Badge>
                </Group>
              )
            })}
        </Stack>
      </Stack>
    </AppCard>
  )
}
