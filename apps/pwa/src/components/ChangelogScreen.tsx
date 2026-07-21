import type { ReactNode } from 'react'
import { Alert, Card, Group, Stack, Text, Title } from '@mantine/core'
import type { ImplementedEntry, InProgressEntry } from '../hooks/useChangelog'

interface ChangelogScreenProps {
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
  configured: boolean
  error: string | null
}

const TYPE_EMOJI: Record<string, { emoji: string; label: string }> = {
  feat: { emoji: '🚀', label: 'Feature' },
  fix: { emoji: '🛠️', label: 'Fix' },
  perf: { emoji: '⚡', label: 'Improvement' },
}

function TypeEmoji({ type }: { type: string }) {
  const meta = TYPE_EMOJI[type]
  if (!meta) {
    return null
  }
  return (
    <span role="img" aria-label={meta.label} title={meta.label}>
      {meta.emoji}
    </span>
  )
}

function Entry({ type, description }: { type: string; description: string }) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group align="flex-start" wrap="nowrap" gap="xs">
        <TypeEmoji type={type} />
        <Text style={{ minWidth: 0 }}>{description}</Text>
      </Group>
    </Card>
  )
}

function Section({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string
  count: number
  emptyLabel: string
  children: ReactNode
}) {
  return (
    <Stack gap="xs">
      <Title order={3} size="h5">
        {title}
      </Title>
      {count === 0 ? (
        <Text size="sm" c="dimmed">
          {emptyLabel}
        </Text>
      ) : (
        children
      )}
    </Stack>
  )
}

/** Presentational "What's new" changelog. Data loading lives in the caller. */
export function ChangelogScreen({
  implemented,
  inProgress,
  configured,
  error,
}: ChangelogScreenProps) {
  return (
    <Stack gap="lg">
      <Title order={2} visibleFrom="sm">
        What&apos;s new
      </Title>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {!error && !configured && (
        <Text size="sm" c="dimmed">
          The changelog isn't configured yet.
        </Text>
      )}

      {!error && configured && (
        <>
          <Section
            title="In progress"
            count={inProgress.length}
            emptyLabel="Nothing in the works right now."
          >
            <Stack gap="xs">
              {inProgress.map((entry) => (
                <Entry key={entry.number} type={entry.type} description={entry.description} />
              ))}
            </Stack>
          </Section>

          <Section title="Implemented" count={implemented.length} emptyLabel="Nothing here yet.">
            <Stack gap="xs">
              {implemented.map((entry) => (
                <Entry key={entry.sha} type={entry.type} description={entry.description} />
              ))}
            </Stack>
          </Section>
        </>
      )}
    </Stack>
  )
}
