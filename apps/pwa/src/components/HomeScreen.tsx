import { Button, Card, Center, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput } from '../hooks/useTaxProfiles'
import { TaxProfileForm } from './TaxProfileForm'

interface HomeScreenProps {
  householdName: string
  inviteCode: string
  email: string
  members: Member[]
  taxProfiles: TaxProfile[]
  financialYear: number
  onUpsertTaxProfile: (input: TaxProfileInput) => Promise<void>
  onSignOut: () => void
}

/** Presentational signed-in household home with per-member tax profiles. Supabase wiring lives in the caller. */
export function HomeScreen({
  householdName,
  inviteCode,
  email,
  members,
  taxProfiles,
  financialYear,
  onUpsertTaxProfile,
  onSignOut,
}: HomeScreenProps) {
  return (
    <Center>
      <Stack gap="lg" maw={460} w="100%" mt="lg">
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Stack align="center" gap="md">
            <Title order={1} ta="center">
              {householdName}
            </Title>
            <Text c="dimmed">Signed in as {email}</Text>
            <Group gap="xs" justify="center" wrap="wrap">
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
            <Text size="sm" c="dimmed" ta="center">
              Share this code with your partner so they can join your household.
            </Text>
            <Button variant="default" fullWidth onClick={onSignOut}>
              Sign out
            </Button>
          </Stack>
        </Card>

        <Stack gap="sm">
          <Title order={2}>Tax profiles (FY{financialYear})</Title>
          {members.map((member) => (
            <TaxProfileForm
              key={member.id}
              member={member}
              initial={taxProfiles.find((profile) => profile.member_id === member.id)}
              onSubmit={onUpsertTaxProfile}
            />
          ))}
        </Stack>
      </Stack>
    </Center>
  )
}
