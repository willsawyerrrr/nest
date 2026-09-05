import { Button, Stack, Text, Title } from '@mantine/core'
import { AppCard } from './AppCard'
import { PageSection } from './PageSection'

interface AccountScreenProps {
  householdName: string
  email: string
  onSignOut: () => void
}

/** Presentational account settings: household name, signed-in email, and sign out. */
export function AccountScreen({ householdName, email, onSignOut }: AccountScreenProps) {
  return (
    <PageSection title="Account">
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
    </PageSection>
  )
}
