import { useState } from 'react'
import { Alert, Badge, Button, Group, PasswordInput, Stack, Text, Title } from '@mantine/core'
import type { CalendarFeedRow } from '../hooks/useCalendarFeed'
import type { Member } from '../hooks/useMembers'
import type { RedbarkCompleteResult, RedbarkConnection } from '../hooks/useRedbarkConnections'
import { AppCard } from './AppCard'
import { CalendarFeedControl } from './CalendarFeedControl'
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

        <Stack gap="xxs">
          {members.map((member) => (
            <Group key={member.id} justify="space-between">
              <Text size="sm">{member.name}</Text>
              <Badge
                size="sm"
                variant="light"
                color={member.up_connected_at != null ? 'green' : 'gray'}
              >
                {member.up_connected_at != null ? 'Connected' : 'Not connected'}
              </Badge>
            </Group>
          ))}
        </Stack>
      </Stack>
    </AppCard>
  )
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
        {result.reason ?? 'Something went wrong completing the connection. Try again.'}
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
        <Button variant="light" loading={busy} onClick={() => void onConnect()}>
          Connect a bank
        </Button>

        {connections.length > 0 && (
          <Stack gap="xxs">
            {connections.map((connection) => (
              <Group key={connection.id} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text size="sm" truncate>
                    {connection.institution_name ?? 'Unknown institution'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {memberName(connection.member_id)}
                  </Text>
                </Group>
                <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Badge
                    size="sm"
                    variant="light"
                    color={connection.status === 'active' ? 'green' : 'gray'}
                  >
                    {connection.status}
                  </Badge>
                  {connection.member_id === currentMemberId && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      loading={busy}
                      onClick={() => void onDisconnect(connection.id)}
                    >
                      Disconnect
                    </Button>
                  )}
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
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
