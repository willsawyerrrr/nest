import { describe, expect, it, vi } from 'vitest'
import { applyLatestVersion } from '../pwa'
import { render, screen } from '../test/render'
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

describe('ChangelogSection', () => {
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

  it('forces the app to the latest version when the screen requests an update', () => {
    hooks.useChangelog.mockReturnValue({ loading: false })
    render(<ChangelogSection />)
    ;(hooks.screenProps as { onUpdate: () => void }).onUpdate()
    expect(applyLatestVersion).toHaveBeenCalledOnce()
  })
})
