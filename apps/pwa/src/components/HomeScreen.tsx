import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Center,
  Code,
  CopyButton,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput } from '../hooks/useTaxProfiles'
import { TaxProfileList } from './TaxProfileList'

interface HomeScreenProps {
  householdName: string
  inviteCode: string | null
  inviteCodeExpiresAt: string | null
  email: string
  currentUserId: string
  members: Member[]
  taxProfiles: TaxProfile[]
  financialYear: number
  onUpsertTaxProfile: (input: TaxProfileInput) => Promise<void>
  onCreateInviteCode: () => Promise<void>
  onRevokeInviteCode: () => Promise<void>
  onConnectUp: (token: string) => Promise<void>
  onDisconnectUp: () => Promise<void>
  upBusy: boolean
  onSignOut: () => void
}

/** The Up-connection card: connect/disconnect for the signed-in member, plus each member's status. */
function ConnectUpCard({
  currentUserId,
  members,
  onConnectUp,
  onDisconnectUp,
  upBusy,
}: Pick<
  HomeScreenProps,
  'currentUserId' | 'members' | 'onConnectUp' | 'onDisconnectUp' | 'upBusy'
>) {
  const [token, setToken] = useState('')
  const me = members.find((member) => member.user_id === currentUserId)
  const connected = me?.up_connected_at != null

  return (
    <Card withBorder shadow="sm" radius="md" p="lg">
      <Stack gap="md">
        <Title order={3} size="h5">
          Connect Up
        </Title>

        {connected ? (
          <Group justify="space-between">
            <Badge color="green" variant="light">
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

        <Stack gap={4}>
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
    </Card>
  )
}

/** Describes when an active invite code lapses, e.g. "Expires in 3 days". */
function expiryLabel(expiresAt: string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now()
  const days = Math.ceil(msLeft / 86_400_000)
  if (days <= 1) {
    return 'Expires within a day'
  }
  return `Expires in ${days} days`
}

/** Presentational signed-in household home with per-member tax profiles. Supabase wiring lives in the caller. */
export function HomeScreen({
  householdName,
  inviteCode,
  inviteCodeExpiresAt,
  email,
  currentUserId,
  members,
  taxProfiles,
  financialYear,
  onUpsertTaxProfile,
  onCreateInviteCode,
  onRevokeInviteCode,
  onConnectUp,
  onDisconnectUp,
  upBusy,
  onSignOut,
}: HomeScreenProps) {
  const codeActive =
    inviteCode !== null &&
    inviteCodeExpiresAt !== null &&
    new Date(inviteCodeExpiresAt).getTime() > Date.now()

  return (
    <Center>
      <Stack gap="lg" maw={460} w="100%" mt="lg">
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Stack align="center" gap="md">
            <Title order={1} ta="center">
              {householdName}
            </Title>
            <Text c="dimmed">Signed in as {email}</Text>
            <Button variant="default" fullWidth onClick={onSignOut}>
              Sign out
            </Button>
          </Stack>
        </Card>

        <Stack gap="sm">
          <Title order={2}>Tax profiles (FY{financialYear})</Title>
          <TaxProfileList members={members} profiles={taxProfiles} onUpsert={onUpsertTaxProfile} />
        </Stack>

        <ConnectUpCard
          currentUserId={currentUserId}
          members={members}
          onConnectUp={onConnectUp}
          onDisconnectUp={onDisconnectUp}
          upBusy={upBusy}
        />

        <Card withBorder shadow="sm" radius="md" p="lg">
          <Stack gap="md">
            <Title order={3} size="h5">
              Invite someone
            </Title>
            {codeActive && inviteCode !== null && inviteCodeExpiresAt !== null ? (
              <Stack gap="xs">
                <Group gap="xs" wrap="wrap">
                  <Text>Invite code:</Text>
                  <Code fz="md">{inviteCode}</Code>
                  <CopyButton value={inviteCode}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" onClick={copy}>
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <Text size="sm" c="dimmed">
                  Share this code with others so they can join your household. It works once and
                  then expires. {expiryLabel(inviteCodeExpiresAt)}.
                </Text>
                <Group gap="xs">
                  <Button size="xs" variant="light" onClick={() => void onCreateInviteCode()}>
                    Regenerate
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={() => void onRevokeInviteCode()}
                  >
                    Revoke
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Generate a single-use code to let someone join your household. It expires after 7
                  days.
                </Text>
                <Button variant="light" onClick={() => void onCreateInviteCode()}>
                  Create invite code
                </Button>
              </Stack>
            )}
          </Stack>
        </Card>
      </Stack>
    </Center>
  )
}
