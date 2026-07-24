import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '../test/render'
import { BreakdownDetailSection } from './BreakdownDetailSection'

const hooks = vi.hoisted(() => ({
  useBreakdowns: vi.fn(),
  useBreakdownItems: vi.fn(),
  detailProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
vi.mock('../hooks/useBreakdownItems', () => ({ useBreakdownItems: hooks.useBreakdownItems }))
vi.mock('../components/BreakdownDetail', () => ({
  BreakdownDetail: (props: Record<string, unknown>) => {
    hooks.detailProps = props
    return <div data-testid="breakdown-detail" data-back-label={String(props.backLabel)} />
  },
}))

function renderAt(ui: ReactElement, entry: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/breakdowns/:id" element={ui} />
        <Route path="/breakdowns" element={<div data-testid="breakdowns-list" />} />
        <Route path="/gifts" element={<div data-testid="gifts-tab" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BreakdownDetailSection', () => {
  it('shows the loading screen while breakdowns load', () => {
    hooks.useBreakdowns.mockReturnValue({ loading: true })
    renderAt(<BreakdownDetailSection householdId="h1" />, '/breakdowns/b1')
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('redirects to the breakdowns tab when the breakdown is not found', () => {
    hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [] })
    renderAt(<BreakdownDetailSection householdId="h1" />, '/breakdowns/missing')
    expect(screen.getByTestId('breakdowns-list')).toBeInTheDocument()
  })

  it('redirects a gift breakdown to the Gifts tab', () => {
    hooks.useBreakdowns.mockReturnValue({
      loading: false,
      breakdowns: [{ id: 'b1', kind: 'gift', name: 'Gifts', line_group: 'wants' }],
    })
    renderAt(<BreakdownDetailSection householdId="h1" />, '/breakdowns/b1')
    expect(screen.getByTestId('gifts-tab')).toBeInTheDocument()
  })

  it('shows the loading screen while a generic breakdown loads its items', () => {
    hooks.useBreakdowns.mockReturnValue({
      loading: false,
      breakdowns: [{ id: 'b1', kind: 'generic', name: 'Meds', line_group: 'needs' }],
      update: vi.fn(),
      remove: vi.fn(),
    })
    hooks.useBreakdownItems.mockReturnValue({ loading: true })
    renderAt(<BreakdownDetailSection householdId="h1" />, {
      pathname: '/breakdowns/b1',
      state: { from: '/budget' },
    })
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the generic editor and forwards update and delete', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)
    hooks.useBreakdowns.mockReturnValue({
      loading: false,
      breakdowns: [{ id: 'b1', kind: 'generic', name: 'Meds', line_group: 'needs' }],
      update,
      remove,
    })
    hooks.useBreakdownItems.mockReturnValue({
      loading: false,
      items: [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    renderAt(<BreakdownDetailSection householdId="h1" />, {
      pathname: '/breakdowns/b1',
      state: { from: '/budget' },
    })
    const detail = screen.getByTestId('breakdown-detail')
    expect(detail).toBeInTheDocument()
    expect(detail).toHaveAttribute('data-back-label', 'Budget')

    const onUpdateBreakdown = hooks.detailProps?.onUpdateBreakdown as (input: {
      name: string
      line_group: string
    }) => Promise<void>
    await onUpdateBreakdown({ name: 'Meds', line_group: 'needs' })
    expect(update).toHaveBeenCalledWith('b1', { name: 'Meds', line_group: 'needs' })

    const onDeleteBreakdown = hooks.detailProps?.onDeleteBreakdown as () => Promise<void>
    await act(async () => {
      await onDeleteBreakdown()
    })
    expect(remove).toHaveBeenCalledWith('b1')
    expect(screen.getByTestId('breakdowns-list')).toBeInTheDocument()
  })
})
