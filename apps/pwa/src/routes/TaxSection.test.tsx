import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { TaxSection } from './TaxSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useInflows: vi.fn(),
  useTaxProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useHelpDebts: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../components/TaxEstimateView', () => ({
  TaxEstimateView: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="tax-view" />
  },
}))

describe('TaxSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useInflows.mockReturnValue({ loading: false })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    render(<TaxSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the tax view and resolves member names', () => {
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    render(<TaxSection householdId="h1" />)
    expect(screen.getByTestId('tax-view')).toBeInTheDocument()

    const memberName = hooks.screenProps?.memberName as (id: string) => string
    expect(memberName('m1')).toBe('Alex')
    expect(memberName('nope')).toBe('Unknown')
    expect(hooks.screenProps?.financialYear).toBe(2027)
  })
})
