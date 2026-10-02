import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { ImplementedEntry, InProgressEntry } from '../hooks/useChangelog'
import { useIsWide } from '../hooks/useIsWide'
import { formatIsoDate } from '../lib/dates'
import { ListRow } from './ListRow'
import { PageSection } from './PageSection'

interface ChangelogScreenProps {
  available: ImplementedEntry[]
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
  configured: boolean
  error: string | null
  onUpdate: () => void
  updating: boolean
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

interface EntryProps {
  type: string
  description: string
  /** ISO timestamp the change landed; absent while it is still in progress. */
  date?: string
}

/**
 * One change as a compact row: type emoji, the description clamped to two lines,
 * and the date. A row whose description is clamped expands to show
 * all of it; a row that already shows it in full has no chevron and does not toggle.
 */
function Entry({ type, description, date }: EntryProps) {
  const wide = useIsWide()
  const [expanded, { toggle }] = useDisclosure(false)
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const when = date === undefined ? null : formatIsoDate(date.slice(0, 10))

  useEffect(() => {
    const measure = () => {
      const el = textRef.current
      if (el && !expanded) {
        setClamped(el.scrollHeight > el.clientHeight)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [description, wide, expanded])

  const expandable = clamped || expanded
  const content = (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      {expandable ? (
        expanded ? (
          <IconChevronDown size={16} />
        ) : (
          <IconChevronRight size={16} />
        )
      ) : (
        <span style={{ width: 16, flexShrink: 0 }} />
      )}
      <TypeEmoji type={type} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text ref={textRef} size="sm" {...(expanded ? {} : { lineClamp: 2 })}>
          {description}
        </Text>
        {!wide && when !== null && (
          <Text size="xs" c="dimmed">
            {when}
          </Text>
        )}
      </Stack>
    </Group>
  )
  return (
    <ListRow gap="xs">
      {expandable ? (
        <UnstyledButton onClick={toggle} aria-expanded={expanded} style={{ flex: 1, minWidth: 0 }}>
          {content}
        </UnstyledButton>
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
      )}
      {wide && (
        <Text size="xs" c="dimmed" w={96} ta="right" style={{ flexShrink: 0 }}>
          {when}
        </Text>
      )}
    </ListRow>
  )
}

function ImplementedEntryRow({ entry }: { entry: ImplementedEntry }) {
  return <Entry type={entry.type} description={entry.description} date={entry.date} />
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
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" component="h3">
        {title}
      </Text>
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
  available,
  implemented,
  inProgress,
  configured,
  error,
  onUpdate,
  updating,
}: ChangelogScreenProps) {
  return (
    <PageSection title="What's new">
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
          {available.length > 0 && (
            <Alert color="info" variant="light" title="Update available">
              <Stack gap="sm">
                <Text size="sm">
                  A newer version of the app is ready. Reload to get{' '}
                  {available.length === 1 ? 'this change' : `these ${available.length} changes`}.
                </Text>
                <Stack gap={0}>
                  {available.map((entry) => (
                    <ImplementedEntryRow key={entry.sha} entry={entry} />
                  ))}
                </Stack>
                {/*
                  The reload takes seconds, and an installed PWA holds its last
                  painted frame for them with no browser chrome to show progress,
                  so a spinner alone can read as a stuck button — the wording is
                  what says "working". A loading button hides its label behind
                  the loader, so both the spinner and the copy are rendered as
                  the loader's own content.
                */}
                <Button
                  onClick={onUpdate}
                  loading={updating}
                  loaderProps={{
                    children: (
                      <Group gap="xs" wrap="nowrap">
                        <Loader size="xs" color="var(--button-color)" />
                        <span>Updating…</span>
                      </Group>
                    ),
                  }}
                  variant="filled"
                  style={{ alignSelf: 'flex-start' }}
                >
                  Reload to update
                </Button>
              </Stack>
            </Alert>
          )}

          <Section
            title="In progress"
            count={inProgress.length}
            emptyLabel="Nothing in the works right now."
          >
            <Stack gap={0}>
              {inProgress.map((entry) => (
                <Entry key={entry.number} type={entry.type} description={entry.description} />
              ))}
            </Stack>
          </Section>

          <Section title="Implemented" count={implemented.length} emptyLabel="Nothing here yet.">
            <Stack gap={0}>
              {implemented.map((entry) => (
                <ImplementedEntryRow key={entry.sha} entry={entry} />
              ))}
            </Stack>
          </Section>
        </>
      )}
    </PageSection>
  )
}
