import { Button, Center, Stack, Text } from '@mantine/core'
import { Logo } from './Logo'

interface SignInScreenProps {
  onSignIn: () => void
}

/** Presentational sign-in screen. Wiring to Supabase auth lives in the caller. */
export function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <Center component="main" className="full-screen">
      <Stack align="center" gap="lg" maw={360} w="100%">
        <Logo variant="lockup" size={56} />
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
