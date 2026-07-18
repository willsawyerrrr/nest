import { Button, Center, Stack, Text, Title } from '@mantine/core'

interface SignInScreenProps {
  onSignIn: () => void
}

/** Presentational sign-in screen. Wiring to Supabase auth lives in the caller. */
export function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <Center component="main" className="full-screen">
      <Stack align="center" gap="lg" maw={360} w="100%">
        <Title order={1} ta="center">
          Personal Budget
        </Title>
        <Text c="dimmed" ta="center">
          Track income, tax, spending, and savings for your household.
        </Text>
        <Button size="md" fullWidth onClick={onSignIn}>
          Continue with Google
        </Button>
      </Stack>
    </Center>
  )
}
