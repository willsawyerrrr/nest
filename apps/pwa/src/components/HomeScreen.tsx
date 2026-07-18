import { Button, Card, Center, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core'

interface HomeScreenProps {
  householdName: string
  inviteCode: string
  email: string
  onSignOut: () => void
}

/** Presentational signed-in home. Supabase wiring lives in the caller. */
export function HomeScreen({ householdName, inviteCode, email, onSignOut }: HomeScreenProps) {
  return (
    <Center>
      <Card withBorder shadow="sm" radius="md" p="lg" maw={420} w="100%" mt="lg">
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
    </Center>
  )
}
