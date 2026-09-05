import { Button, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'
import { AppCard } from './AppCard'
import { PageSection } from './PageSection'

interface HouseholdScreenProps {
  householdName: string
  email: string
  onSignOut: () => void
  inviteCode: string | null
  inviteCodeExpiresAt: string | null
  onCreateInviteCode: () => Promise<void>
  onRevokeInviteCode: () => Promise<void>
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

/**
 * Presentational household settings: household name, signed-in email, sign
 * out, and the partner invite code (create, regenerate, or revoke).
 */
export function HouseholdScreen({
  householdName,
  email,
  onSignOut,
  inviteCode,
  inviteCodeExpiresAt,
  onCreateInviteCode,
  onRevokeInviteCode,
}: HouseholdScreenProps) {
  const codeActive =
    inviteCode !== null &&
    inviteCodeExpiresAt !== null &&
    new Date(inviteCodeExpiresAt).getTime() > Date.now()

  return (
    <PageSection title="Household">
      <AppCard>
        <Stack align="center" gap="md">
          <Title order={1} ta="center">
            {householdName}
          </Title>
          <Text c="dimmed">Signed in as {email}</Text>
          <Button variant="default" fullWidth onClick={onSignOut}>
            Sign out
          </Button>
        </Stack>
      </AppCard>

      <AppCard>
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
                Share this code with others so they can join your household. It works once and then
                expires. {expiryLabel(inviteCodeExpiresAt)}.
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
      </AppCard>
    </PageSection>
  )
}
