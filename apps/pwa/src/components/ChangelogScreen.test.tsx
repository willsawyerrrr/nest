import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { ChangelogScreen } from './ChangelogScreen'
import type { ImplementedEntry, InProgressEntry } from '../hooks/useChangelog'

const inProgress: InProgressEntry[] = [
  { type: 'feat', scope: 'splits', description: 'Confirm pay splits', number: 120, url: 'u' },
  { type: 'perf', scope: 'up-sync', description: 'Batch account upserts', number: 121, url: 'u' },
]

const implemented: ImplementedEntry[] = [
  {
    type: 'fix',
    scope: null,
    description: 'Correct a rounding error',
    date: '2026-07-08T00:00:00Z',
    sha: 'ccc333',
  },
]

function renderScreen(overrides: Partial<Parameters<typeof ChangelogScreen>[0]> = {}) {
  return render(
    <ChangelogScreen
      implemented={[]}
      inProgress={[]}
      configured
      loading={false}
      error={null}
      {...overrides}
    />,
  )
}

describe('ChangelogScreen', () => {
  it('prefixes entries with a type emoji and leads with the scope', () => {
    renderScreen({ inProgress, implemented })

    // Feature entry: emoji labelled "Feature", dimmed scope, then description.
    expect(screen.getByText('Confirm pay splits')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Feature' })).toBeInTheDocument()
    expect(screen.getByText(/^splits —/)).toBeInTheDocument()

    // Improvement (perf) entry: emoji labelled "Improvement", scope, description.
    expect(screen.getByText('Batch account upserts')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Improvement' })).toBeInTheDocument()
    expect(screen.getByText(/^up-sync —/)).toBeInTheDocument()

    // Fix entry with no scope: emoji labelled "Fix", then description alone.
    expect(screen.getByText('Correct a rounding error')).toBeInTheDocument()
    expect(screen.getByTitle('Fix')).toBeInTheDocument()
  })

  it('shows a hint for an empty section', () => {
    renderScreen({ inProgress: [], implemented })

    // In progress is empty, so its hint shows; Implemented still renders its entry.
    expect(screen.getAllByText('Nothing here yet.')).toHaveLength(1)
    expect(screen.getByText('Correct a rounding error')).toBeInTheDocument()
  })

  it('shows a loader while loading', () => {
    const { container } = renderScreen({ loading: true })
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument()
  })

  it('shows an error alert', () => {
    renderScreen({ error: "Could not load what's new. Try again later." })
    expect(screen.getByText(/could not load what's new/i)).toBeInTheDocument()
  })

  it('shows a not-configured note', () => {
    renderScreen({ configured: false })
    expect(screen.getByText(/isn't configured yet/i)).toBeInTheDocument()
  })
})
