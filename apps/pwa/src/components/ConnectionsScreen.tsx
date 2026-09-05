import { useState } from 'react'
import { Badge, Button, Group, PasswordInput, Stack, Text, Title } from '@mantine/core'
import type { CalendarFeedRow } from '../hooks/useCalendarFeed'
import type { Member } from '../hooks/useMembers'
import { AppCard } from './AppCard'
import { CalendarFeedControl } from './CalendarFeedControl'
import { PageSection } from './PageSection'

interface ConnectionsScreenProps {
  currentUserId: string
  members: Member[]
  onConnectUp: (token: string) => Promise<void>
  onDisconnectUp: () => Promise<void>
  upBusy: boolean
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

/** Presentational outside-source connections: Up and the calendar feed. */
export function ConnectionsScreen({
  currentUserId,
  members,
  onConnectUp,
  onDisconnectUp,
  upBusy,
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

      <CalendarFeedControl
        status={calendarFeed.status}
        onCreate={calendarFeed.onCreate}
        onRevoke={calendarFeed.onRevoke}
      />
    </PageSection>
  )
}
