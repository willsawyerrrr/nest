import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLatestVersion } from '../pwa'
import { act, render, screen } from '../test/render'
import { ChangelogSection } from './ChangelogSection'

const hooks = vi.hoisted(() => ({ useChangelog: vi.fn(), screenProps: null as unknown }))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useChangelog', () => ({ useChangelog: hooks.useChangelog }))
// The pwa module runs `registerSW` (a Vite virtual module) at import time, so it
// is mocked to keep the route unit-testable outside a build.
vi.mock('../pwa', () => ({ applyLatestVersion: vi.fn() }))
vi.mock('../components/ChangelogScreen', () => ({
  ChangelogScreen: (props: unknown) => {
    hooks.screenProps = props
    return <div data-testid="changelog-screen" />
  },
}))

function screenProps() {
  return hooks.screenProps as { onUpdate: () => void; updating: boolean }
}

/** Requests an update the way the screen's button does, flushing the state it sets. */
async function tapUpdate() {
  await act(async () => {
    screenProps().onUpdate()
  })
}

describe('ChangelogSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading screen while the changelog loads', () => {
    hooks.useChangelog.mockReturnValue({ loading: true })
    render(<ChangelogSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the changelog screen with loaded data', () => {
    hooks.useChangelog.mockReturnValue({
      loading: false,
      available: [{ description: 'c' }],
      implemented: [{ description: 'a' }],
      inProgress: [{ description: 'b' }],
      configured: true,
      error: null,
    })
    render(<ChangelogSection />)
    expect(screen.getByTestId('changelog-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({
      available: [{ description: 'c' }],
      implemented: [{ description: 'a' }],
      inProgress: [{ description: 'b' }],
      configured: true,
      error: null,
    })
  })

  it('forces the app to the latest version when the screen requests an update', async () => {
    hooks.useChangelog.mockReturnValue({ loading: false })
    render(<ChangelogSection />)

    expect(screenProps().updating).toBe(false)
    await tapUpdate()

    expect(applyLatestVersion).toHaveBeenCalledOnce()
    // The reload replaces the page, so the screen stays in its updating state.
    expect(screenProps().updating).toBe(true)
  })

  it('ignores a second update request while one is in flight', async () => {
    hooks.useChangelog.mockReturnValue({ loading: false })
    vi.mocked(applyLatestVersion).mockReturnValue(new Promise<void>(() => {}))
    render(<ChangelogSection />)

    await tapUpdate()
    await tapUpdate()

    expect(applyLatestVersion).toHaveBeenCalledOnce()
  })

  it('offers the update again when applying it fails', async () => {
    hooks.useChangelog.mockReturnValue({ loading: false })
    vi.mocked(applyLatestVersion).mockRejectedValue(new Error('offline'))
    render(<ChangelogSection />)

    await tapUpdate()
    expect(screenProps().updating).toBe(false)

    await tapUpdate()
    expect(applyLatestVersion).toHaveBeenCalledTimes(2)
  })
})
