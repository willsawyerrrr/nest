import { Button, Card, Center, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput } from '../hooks/useTaxProfiles'
import { TaxProfileList } from './TaxProfileList'

interface HomeScreenProps {
  householdName: string
  inviteCode: string | null
  inviteCodeExpiresAt: string | null
  email: string
  members: Member[]
  taxProfiles: TaxProfile[]
  financialYear: number
  onUpsertTaxProfile: (input: TaxProfileInput) => Promise<void>
  onCreateInviteCode: () => Promise<void>
  onRevokeInviteCode: () => Promise<void>
  onSignOut: () => void
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
  members,
  taxProfiles,
  financialYear,
  onUpsertTaxProfile,
  onCreateInviteCode,
  onRevokeInviteCode,
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

        <Card withBorder shadow="sm" radius="md" p="lg">
          <Stack gap="md">
            <Title order={3}>Invite someone</Title>
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
