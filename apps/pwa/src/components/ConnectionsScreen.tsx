import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { IconPlugConnectedX } from '@tabler/icons-react'
import type { CalendarFeedRow } from '../hooks/useCalendarFeed'
import type { Member } from '../hooks/useMembers'
import { type RedbarkCompleteResult, type RedbarkConnection } from '../hooks/useRedbarkConnections'
import { AppCard } from './AppCard'
import { CalendarFeedControl } from './CalendarFeedControl'
import { ConfirmDeleteModal, type ConfirmDeleteTarget } from './ConfirmDeleteModal'
import { ListRow } from './ListRow'
import { PageSection } from './PageSection'

interface ConnectionsScreenProps {
  currentUserId: string
  members: Member[]
  onConnectUp: (token: string) => Promise<void>
  onDisconnectUp: () => Promise<void>
  upBusy: boolean
  redbark: {
    connections: RedbarkConnection[]
    busy: boolean
    onConnect: () => Promise<void>
    onDisconnect: (connectionId: string) => Promise<void>
    completeResult: RedbarkCompleteResult | null
    onDismissCompleteResult: () => void
  }
  calendarFeed: {
    status: CalendarFeedRow | null
    onCreate: () => Promise<string>
    onRevoke: () => Promise<void>
  }
}

/** A fixed-width status pill, so statuses align down a list of rows. */
function StatusBadge({ label, positive }: { label: string; positive: boolean }) {
  return (
    <Badge
      size="xs"
      variant="light"
      color={positive ? 'green' : 'gray'}
      style={{ width: '5.5rem', flexShrink: 0 }}
    >
      {label}
    </Badge>
  )
}

/** The Up-connection card: connect/disconnect for the signed-in member, plus each member's status. */
function ConnectUpCard({
  currentUserId,
  members,
  onConnectUp,
  onDisconnectUp,
  upBusy,
}: Pick<
  ConnectionsScreenProps,
  'currentUserId' | 'members' | 'onConnectUp' | 'onDisconnectUp' | 'upBusy'
>) {
  const [token, setToken] = useState('')
  const me = members.find((member) => member.user_id === currentUserId)
  const connected = me?.up_connected_at != null

  return (
    <AppCard>
      <Stack gap="md">
        <Title order={3} size="h5">
          Connect Up
        </Title>

        {connected ? (
          <Group justify="space-between">
            <Badge size="sm" color="green" variant="light">
              Connected
            </Badge>
            <Button
              size="xs"
              variant="subtle"
              color="red"
              loading={upBusy}
              onClick={() => void onDisconnectUp()}
            >
              Disconnect
            </Button>
          </Group>
        ) : (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Paste your Up personal access token to connect your accounts. It is stored securely
              and never shown again.
            </Text>
            <PasswordInput
              label="Up personal access token"
              placeholder="up:yeah:…"
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
            />
            <Button
              variant="light"
              disabled={token.trim() === ''}
              loading={upBusy}
              onClick={() => {
                void onConnectUp(token.trim())
                setToken('')
              }}
            >
              Connect
            </Button>
          </Stack>
        )}

        <Stack gap={0}>
          {members.map((member) => (
            <ListRow key={member.id} gap="sm">
              <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {member.name}
              </Text>
              <StatusBadge
                label={member.up_connected_at != null ? 'Connected' : 'Not connected'}
                positive={member.up_connected_at != null}
              />
            </ListRow>
          ))}
        </Stack>
      </Stack>
    </AppCard>
  )
}

/** Where a Redbark plan without API access is upgraded. */
const REDBARK_BILLING_URL = 'https://app.redbark.com/settings/billing'

/** Our own copy for a failed Redbark call, keyed on the edge function's stable error code. */
function RedbarkFailureMessage({ code }: { code: string | null }) {
  switch (code) {
    case 'plan_upgrade_required':
      return (
        <>
          Bank connections need the Redbark Developer or Professional plan.{' '}
          <Anchor href={REDBARK_BILLING_URL} target="_blank" rel="noreferrer" inherit>
            Upgrade your plan
          </Anchor>
          .
        </>
      )
    case 'redbark_auth_failed':
      return 'Bank connections are misconfigured. Try again later.'
    default:
      return 'Redbark is unavailable right now. Try again shortly.'
  }
}

/** The result banner shown once, after resolving a pending Redbark connection found on mount. */
function RedbarkCompleteBanner({
  result,
  onDismiss,
}: {
  result: RedbarkCompleteResult
  onDismiss: () => void
}) {
  if (result.status === 'connected') {
    return (
      <Alert
        color="positive"
        variant="light"
        title="Bank connected"
        onClose={onDismiss}
        withCloseButton
        closeButtonLabel="Dismiss"
      >
        Syncing its accounts now.
      </Alert>
    )
  }
  if (result.status === 'failed') {
    return (
      <Alert
        color="negative"
        variant="light"
        title="Connection failed"
        onClose={onDismiss}
        withCloseButton
        closeButtonLabel="Dismiss"
      >
        <RedbarkFailureMessage code={result.code} />
      </Alert>
    )
  }
  return (
    <Alert
      color="info"
      variant="light"
      title="Still connecting"
      onClose={onDismiss}
      withCloseButton
      closeButtonLabel="Dismiss"
    >
      The connection hasn’t finished yet. Check back shortly, or try connecting again.
    </Alert>
  )
}

/** The Redbark-connection card: connect a bank, plus each household connection's status. */
function ConnectRedbarkCard({
  currentUserId,
  members,
  redbark,
}: Pick<ConnectionsScreenProps, 'currentUserId' | 'members' | 'redbark'>) {
  const { connections, busy, onConnect, onDisconnect, completeResult, onDismissCompleteResult } =
    redbark
  const [connectFailure, setConnectFailure] = useState<{ code: string | null }>()
  const connect = async () => {
    setConnectFailure(undefined)
    try {
      await onConnect()
    } catch (error) {
      setConnectFailure({ code: (error as { code?: string | null }).code ?? null })
    }
  }
  const [disconnecting, setDisconnecting] = useState<ConfirmDeleteTarget | null>(null)
  const currentMemberId = members.find((member) => member.user_id === currentUserId)?.id
  const memberName = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? 'Unknown'

  return (
    <AppCard>
      <Stack gap="md">
        <Title order={3} size="h5">
          Connect a bank
        </Title>

        {completeResult && (
          <RedbarkCompleteBanner result={completeResult} onDismiss={onDismissCompleteResult} />
        )}

        <Text size="sm" c="dimmed">
          Connect a bank account via Redbark to fund budget items and pay splits, or link it as a
          savings goal's saver. You'll be sent to a hosted consent screen to authorise access.
        </Text>
        <Button variant="light" loading={busy} onClick={() => void connect()}>
          Connect a bank
        </Button>
        {connectFailure && (
          <Alert
            color="negative"
            variant="light"
            title="Couldn’t connect a bank"
            onClose={() => setConnectFailure(undefined)}
            withCloseButton
            closeButtonLabel="Dismiss"
          >
            <RedbarkFailureMessage code={connectFailure.code} />
          </Alert>
        )}

        {connections.length > 0 && (
          <Stack gap={0}>
            {connections.map((connection) => (
              <ListRow key={connection.id} gap="sm">
                <Text size="sm" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
                  {connection.institution_name ?? 'Unknown institution'}
                </Text>
                <Text size="xs" c="dimmed" truncate style={{ width: '4.5rem', flexShrink: 0 }}>
                  {memberName(connection.member_id)}
                </Text>
                <StatusBadge label={connection.status} positive={connection.status === 'active'} />
                <div style={{ width: 28, flexShrink: 0 }}>
                  {connection.member_id === currentMemberId && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Disconnect ${connection.institution_name ?? 'bank'}`}
                      loading={busy}
                      onClick={() =>
                        setDisconnecting({
                          title: 'Disconnect bank?',
                          itemLabel: connection.institution_name ?? 'this bank',
                          confirmLabel: 'Disconnect',
                          description: 'Its accounts stop syncing.',
                          onConfirm: () => onDisconnect(connection.id),
                        })
                      }
                    >
                      <IconPlugConnectedX size={16} />
                    </ActionIcon>
                  )}
                </div>
              </ListRow>
            ))}
          </Stack>
        )}
      </Stack>
      <ConfirmDeleteModal
        target={disconnecting}
        deleting={busy}
        onConfirm={() => {
          void disconnecting?.onConfirm()
          setDisconnecting(null)
        }}
        onCancel={() => setDisconnecting(null)}
      />
    </AppCard>
  )
}

/** Presentational outside-source connections: Up, Redbark, and the calendar feed. */
export function ConnectionsScreen({
  currentUserId,
  members,
  onConnectUp,
  onDisconnectUp,
  upBusy,
  redbark,
  calendarFeed,
}: ConnectionsScreenProps) {
  return (
    <PageSection title="Connections">
      <ConnectUpCard
        currentUserId={currentUserId}
        members={members}
        onConnectUp={onConnectUp}
        onDisconnectUp={onDisconnectUp}
        upBusy={upBusy}
      />

      <ConnectRedbarkCard currentUserId={currentUserId} members={members} redbark={redbark} />

      <CalendarFeedControl
        status={calendarFeed.status}
        onCreate={calendarFeed.onCreate}
        onRevoke={calendarFeed.onRevoke}
      />
    </PageSection>
  )
}
