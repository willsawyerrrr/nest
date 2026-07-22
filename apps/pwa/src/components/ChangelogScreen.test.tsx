import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ImplementedEntry, InProgressEntry } from '../hooks/useChangelog'
import { render, screen } from '../test/render'
import { ChangelogScreen } from './ChangelogScreen'

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

const available: ImplementedEntry[] = [
  {
    type: 'feat',
    scope: 'goals',
    description: 'Add a savings goal ring',
    date: '2026-07-11T00:00:00Z',
    sha: 'eee555',
  },
]

function renderScreen(overrides: Partial<Parameters<typeof ChangelogScreen>[0]> = {}) {
  return render(
    <ChangelogScreen
      available={[]}
      implemented={[]}
      inProgress={[]}
      configured
      error={null}
      onUpdate={() => {}}
      {...overrides}
    />,
  )
}

describe('ChangelogScreen', () => {
  it('prefixes entries with a type emoji and shows no scope', () => {
    renderScreen({ inProgress, implemented })

    // Feature entry: emoji labelled "Feature", then description with no scope.
    expect(screen.getByText('Confirm pay splits')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Feature' })).toBeInTheDocument()
    expect(screen.queryByText(/splits —/)).not.toBeInTheDocument()

    // Improvement (perf) entry: emoji labelled "Improvement", description, no scope.
    expect(screen.getByText('Batch account upserts')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Improvement' })).toBeInTheDocument()
    expect(screen.queryByText(/up-sync —/)).not.toBeInTheDocument()

    // Fix entry: emoji labelled "Fix", then description.
    expect(screen.getByText('Correct a rounding error')).toBeInTheDocument()
    expect(screen.getByTitle('Fix')).toBeInTheDocument()
  })

  it('shows the update-available section and reloads on click when a newer build exists', async () => {
    const onUpdate = vi.fn()
    renderScreen({ available, onUpdate })

    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(screen.getByText('Add a savings goal ring')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /reload to update/i }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('hides the update-available section when nothing newer exists', () => {
    renderScreen({ available: [], implemented })
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reload to update/i })).not.toBeInTheDocument()
  })

  it('shows a hint for an empty section', () => {
    renderScreen({ inProgress: [], implemented })

    // In progress is empty, so its hint shows; Implemented still renders its entry.
    expect(screen.getByText('Nothing in the works right now.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing here yet.')).not.toBeInTheDocument()
    expect(screen.getByText('Correct a rounding error')).toBeInTheDocument()
  })

  it('shows an error alert', () => {
    renderScreen({ error: "Could not load what's new. Try again later." })
    expect(screen.getByText(/could not load what's new/i)).toBeInTheDocument()
  })

  it('shows a not-configured note', () => {
    renderScreen({ configured: false })
    expect(screen.getByText(/isn't configured yet/i)).toBeInTheDocument()
  })

  it('renders no emoji for an unrecognised type', () => {
    renderScreen({
      implemented: [
        {
          type: 'chore',
          scope: null,
          description: 'Tidy things up',
          date: '2026-07-08T00:00:00Z',
          sha: 'abc123',
        },
      ],
    })

    expect(screen.getByText('Tidy things up')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
