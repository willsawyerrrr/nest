import type { ReactNode } from 'react'
import { Alert, Badge, Card, Group, Loader, Stack, Text, Title } from '@mantine/core'
import type { ImplementedEntry, InProgressEntry } from '../hooks/useChangelog'

interface ChangelogScreenProps {
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
  configured: boolean
  loading: boolean
  error: string | null
}

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  feat: { label: 'Feature', color: 'teal' },
  fix: { label: 'Fix', color: 'red' },
  perf: { label: 'Improvement', color: 'blue' },
}

function TypeBadge({ type }: { type: string }) {
  const badge = TYPE_BADGES[type]
  if (!badge) {
    return null
  }
  return (
    <Badge size="sm" variant="light" color={badge.color}>
      {badge.label}
    </Badge>
  )
}

function Entry({
  type,
  scope,
  description,
}: {
  type: string
  scope: string | null
  description: string
}) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Text style={{ minWidth: 0 }}>{description}</Text>
        <Group gap="xs" wrap="nowrap">
          {scope && (
            <Text size="xs" c="dimmed">
              {scope}
            </Text>
          )}
          <TypeBadge type={type} />
        </Group>
      </Group>
    </Card>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <Stack gap="xs">
      <Title order={3} size="h5">
        {title}
      </Title>
      {count === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing here yet.
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
  loading,
  error,
}: ChangelogScreenProps) {
  return (
    <Stack gap="lg">
      <Title order={2}>What's new</Title>

      {loading && <Loader />}

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {!loading && !error && !configured && (
        <Text size="sm" c="dimmed">
          The changelog isn't configured yet.
        </Text>
      )}

      {!loading && !error && configured && (
        <>
          <Section title="In progress" count={inProgress.length}>
            <Stack gap="xs">
              {inProgress.map((entry) => (
                <Entry
                  key={entry.number}
                  type={entry.type}
                  scope={entry.scope}
                  description={entry.description}
                />
              ))}
            </Stack>
          </Section>

          <Section title="Implemented" count={implemented.length}>
            <Stack gap="xs">
              {implemented.map((entry) => (
                <Entry
                  key={entry.sha}
                  type={entry.type}
                  scope={entry.scope}
                  description={entry.description}
                />
              ))}
            </Stack>
          </Section>
        </>
      )}
    </Stack>
  )
}
