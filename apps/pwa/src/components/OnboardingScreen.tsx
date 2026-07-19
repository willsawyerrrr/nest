import { useState, type FormEvent } from 'react'
import {
  Button,
  Card,
  Center,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'

interface OnboardingScreenProps {
  onCreate: (name: string, memberName: string) => void | Promise<void>
  onJoin: (code: string, memberName: string) => void | Promise<void>
}

type Mode = 'create' | 'join'

/** Presentational onboarding: create a household or join one by invite code. */
export function OnboardingScreen({ onCreate, onJoin }: OnboardingScreenProps) {
  const [mode, setMode] = useState<Mode>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [memberName, setMemberName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const firstField = mode === 'create' ? name : code
  const canSubmit = firstField.trim() !== '' && memberName.trim() !== '' && !submitting

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'create') {
        await onCreate(name.trim(), memberName.trim())
      } else {
        await onJoin(code.trim(), memberName.trim())
      }
    } catch {
      setError(
        mode === 'create'
          ? 'Could not create your household. Please try again.'
          : 'Could not join that household. Check the invite code and try again.',
      )
      setSubmitting(false)
    }
  }

  return (
    <Center component="main" className="full-screen">
      <Card withBorder shadow="sm" radius="md" p="lg" maw={400} w="100%">
        <Stack gap="md">
          <Title order={2}>
            {mode === 'create' ? 'Create your household' : 'Join a household'}
          </Title>
          <Text c="dimmed">
            {mode === 'create'
              ? 'Name your household and yourself to get started.'
              : 'Enter the invite code your partner shared with you.'}
          </Text>
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={(value) => switchMode(value as Mode)}
            data={[
              { value: 'create', label: 'Create' },
              { value: 'join', label: 'Join' },
            ]}
          />
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              {mode === 'create' ? (
                <TextInput
                  label="Household name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  autoFocus
                />
              ) : (
                <TextInput
                  label="Invite code"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  autoFocus
                />
              )}
              <TextInput
                label="Your name"
                value={memberName}
                onChange={(event) => setMemberName(event.currentTarget.value)}
              />
              {error && (
                <Text role="alert" c="negative" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" fullWidth disabled={!canSubmit}>
                {mode === 'create'
                  ? submitting
                    ? 'Creating…'
                    : 'Create household'
                  : submitting
                    ? 'Joining…'
                    : 'Join household'}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  )
}
