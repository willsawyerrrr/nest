import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanningGoalEta, PlanningOverride } from '../components/PlanningScreen'
import {
  makeBudgetLine,
  makeGiftDiscretionaryBudget,
  makeGoal,
  makeInflow,
  makeSaver,
} from '../test/fixtures'
import { render, screen } from '../test/render'
import { PlanningSection } from './PlanningSection'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useInflows: vi.fn(),
  useBudgetLines: vi.fn(),
  useGoals: vi.fn(),
  useSavers: vi.fn(),
  useAccounts: vi.fn(),
  useTaxProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useSuperProfiles: vi.fn(),
  useHelpDebts: vi.fn(),
  useDeductions: vi.fn(),
  useEquityGrants: vi.fn(),
  useTemporaryItems: vi.fn(),
  useGifts: vi.fn(),
  useBreakdowns: vi.fn(),
  planning: {
    active: true,
    layerFor: vi.fn(),
    resetRow: vi.fn(),
    resetAll: vi.fn(),
    exit: vi.fn(),
  },
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../components/PlanningModeProvider', () => ({ usePlanningMode: () => hooks.planning }))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useSavers', () => ({ useSavers: hooks.useSavers }))
vi.mock('../hooks/useAccounts', () => ({ useAccounts: hooks.useAccounts }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useSuperProfiles', () => ({ useSuperProfiles: hooks.useSuperProfiles }))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useEquityGrants', () => ({ useEquityGrants: hooks.useEquityGrants }))
vi.mock('../hooks/useTemporaryItems', () => ({ useTemporaryItems: hooks.useTemporaryItems }))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
vi.mock('../components/PlanningScreen', () => ({
  PlanningScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="planning-screen" />
  },
}))

function mockLoaded() {
  hooks.planning.active = true
  hooks.planning.layerFor.mockReturnValue(undefined)
  hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
  hooks.useInflows.mockReturnValue({ loading: false, inflows: [], baselineInflows: [] })
  hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [], baselineLines: [] })
  hooks.useGoals.mockReturnValue({ loading: false, goals: [], baselineGoals: [] })
  hooks.useSavers.mockReturnValue({ loading: false, savers: [] })
  hooks.useAccounts.mockReturnValue({ loading: false, accounts: [] })
  hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
  hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
  hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
  hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
  hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
  hooks.useEquityGrants.mockReturnValue({ loading: false, grants: [] })
  hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
  hooks.useGifts.mockReturnValue({ loading: false, budgets: [], recipients: [] })
  hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
}

function renderSection() {
  return render(
    <MemoryRouter initialEntries={['/planning']}>
      <Routes>
        <Route path="/planning" element={<PlanningSection />} />
        <Route path="/summary" element={<div data-testid="summary" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PlanningSection', () => {
  it('redirects to the summary when planning mode is off', () => {
    mockLoaded()
    hooks.planning.active = false
    renderSection()
    expect(screen.getByTestId('summary')).toBeInTheDocument()
  })

  it('shows the loading screen until every source has loaded', () => {
    mockLoaded()
    hooks.useGoals.mockReturnValue({ loading: true })
    renderSection()
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('lists each held override with its was → now change', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [makeInflow({ id: 'i1', name: 'Day job', amount_cents: 150_000 })],
      baselineInflows: [makeInflow({ id: 'i1', name: 'Day job', amount_cents: 100_000 })],
    })
    hooks.planning.layerFor.mockImplementation((table: string) =>
      table === 'inflows'
        ? { updates: { i1: { amount_cents: 150_000 } }, creates: [], deletes: [] }
        : table === 'savings_goal'
          ? { updates: {}, creates: [{ id: 'g9', name: 'New goal' }], deletes: [] }
          : { updates: {}, creates: [], deletes: ['b3'] },
    )
    hooks.useBudgetLines.mockReturnValue({
      loading: false,
      lines: [],
      baselineLines: [makeBudgetLine({ id: 'b3', name: 'Gym' })],
    })
    renderSection()

    const overrides = hooks.screenProps?.overrides as PlanningOverride[]
    const update = overrides.find((o) => o.kind === 'update')!
    expect(update.rowName).toBe('Day job')
    expect(update.changes[0]).toEqual({
      field: 'amount_cents',
      was: '$1,000.00',
      now: '$1,500.00',
    })
    expect(overrides.some((o) => o.kind === 'create' && o.rowName === 'New goal')).toBe(true)
    expect(overrides.some((o) => o.kind === 'delete' && o.rowName === 'Gym')).toBe(true)
  })

  it('lists only the fields an edit actually moved', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [makeInflow({ id: 'i1', name: 'Day job', amount_cents: 150_000 })],
      baselineInflows: [makeInflow({ id: 'i1', name: 'Day job', amount_cents: 100_000 })],
    })
    hooks.planning.layerFor.mockImplementation((table: string) =>
      table === 'inflows'
        ? {
            updates: { i1: { name: 'Day job', amount_cents: 150_000, taxable: true } },
            creates: [],
            deletes: [],
          }
        : undefined,
    )
    renderSection()

    const overrides = hooks.screenProps?.overrides as PlanningOverride[]
    const update = overrides.find((o) => o.kind === 'update')!
    expect(update.changes.map((c) => c.field)).toEqual(['amount_cents'])
  })

  it('drops an edit whose fields all match the baseline', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [makeInflow({ id: 'i1', name: 'Day job' })],
      baselineInflows: [makeInflow({ id: 'i1', name: 'Day job' })],
    })
    hooks.planning.layerFor.mockImplementation((table: string) =>
      table === 'inflows'
        ? { updates: { i1: { name: 'Day job', amount_cents: 5_000_00 } }, creates: [], deletes: [] }
        : undefined,
    )
    renderSection()

    expect(hooks.screenProps?.overrides).toEqual([])
  })

  it('resolves account, saver, and breakdown ids to names, and shows the id when nothing resolves', () => {
    mockLoaded()
    const line = (id: string) =>
      makeBudgetLine({ id, name: `Line ${id}`, destination_account_id: null })
    hooks.useBudgetLines.mockReturnValue({
      loading: false,
      lines: [line('b1'), line('b2')],
      baselineLines: [line('b1'), line('b2')],
    })
    hooks.useAccounts.mockReturnValue({
      loading: false,
      accounts: [{ id: 'acc1', name: 'Everyday' }],
    })
    hooks.useSavers.mockReturnValue({
      loading: false,
      savers: [makeSaver({ id: 's1', name: 'Emergency fund' })],
    })
    hooks.useBreakdowns.mockReturnValue({
      loading: false,
      breakdowns: [{ id: 'bd1', name: 'Medications' }],
      items: [],
    })
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [makeGoal({ id: 'g1', name: 'Car', linked_account_id: 's1' })],
      baselineGoals: [makeGoal({ id: 'g1', name: 'Car', linked_account_id: null })],
    })
    hooks.planning.layerFor.mockImplementation((table: string) =>
      table === 'budget_line'
        ? {
            updates: {
              b1: { destination_account_id: 'acc1', breakdown_id: 'bd1' },
              b2: { destination_account_id: 'gone' },
            },
            creates: [],
            deletes: [],
          }
        : table === 'savings_goal'
          ? { updates: { g1: { linked_account_id: 's1' } }, creates: [], deletes: [] }
          : undefined,
    )
    renderSection()

    const overrides = hooks.screenProps?.overrides as PlanningOverride[]
    const changeFor = (rowName: string, field: string) =>
      overrides.find((o) => o.rowName === rowName)?.changes.find((c) => c.field === field)?.now
    expect(changeFor('Line b1', 'destination_account_id')).toBe('Everyday')
    expect(changeFor('Line b1', 'breakdown_id')).toBe('Medications')
    expect(changeFor('Line b2', 'destination_account_id')).toBe('gone')
    expect(changeFor('Car', 'linked_account_id')).toBe('Emergency fund')
  })

  it('rolls up the buffer, tax, take-home, net worth, and each goal ETA', () => {
    mockLoaded()
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [makeGoal({ id: 'g1', name: 'Car', target_amount_cents: 1_000_000 })],
      baselineGoals: [makeGoal({ id: 'g1', name: 'Car', target_amount_cents: 1_000_000 })],
    })
    renderSection()

    const figures = hooks.screenProps?.figures as { label: string }[]
    expect(figures.map((f) => f.label)).toEqual([
      'Fortnightly buffer',
      'Annual tax',
      'Annual take-home',
      'Net worth',
      'Projected net worth',
    ])
    const goalEtas = hooks.screenProps?.goalEtas as { name: string }[]
    expect(goalEtas).toEqual([{ name: 'Car', proposedIso: null, baselineIso: null }])
  })

  it('moves the fortnightly buffer when a sandbox edit ends an inflow before now', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'))
    mockLoaded()
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [
        {
          id: 'p1',
          household_id: 'h1',
          member_id: 'm1',
          financial_year: 2027,
          residency: 'resident',
          has_private_hospital_cover: false,
          created_at: '',
          updated_at: '',
        },
      ],
      financialYear: 2027,
    })
    const salary = makeInflow({ id: 'i1', schedule: 'annual', amount_cents: 120_000_00 })
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [{ ...salary, ends_on: '2026-09-30' }],
      baselineInflows: [salary],
    })
    renderSection()

    const figures = hooks.screenProps?.figures as {
      label: string
      baselineCents: number
      proposedCents: number
    }[]
    const buffer = figures.find((f) => f.label === 'Fortnightly buffer')!
    // The proposed sandbox ends the salary in the past, so its buffer drops to
    // the baseline's less the whole fortnightly take-home.
    expect(buffer.proposedCents).toBeLessThan(buffer.baselineCents)
  })

  it('folds the ad hoc gift buffer into the external gift line, like the Budget and Summary tabs', () => {
    mockLoaded()
    const externalGiftLine = makeBudgetLine({
      id: 'bl-gifts',
      name: 'Gifts (others)',
      line_group: 'wants',
      amount_cents: 0,
      frequency: 'annual',
      is_gift_line: true,
      gift_recipient_member_id: null,
    })
    hooks.useBudgetLines.mockReturnValue({
      loading: false,
      lines: [externalGiftLine],
      baselineLines: [externalGiftLine],
    })
    const bufferCents = () => {
      const figures = hooks.screenProps?.figures as { label: string; proposedCents: number }[]
      return figures.find((f) => f.label === 'Fortnightly buffer')!.proposedCents
    }

    renderSection()
    const plain = bufferCents()

    hooks.useGifts.mockReturnValue({
      loading: false,
      budgets: [],
      recipients: [],
      discretionaryBudget: makeGiftDiscretionaryBudget({ budgeted_amount_cents: 520_00 }),
    })
    renderSection()

    // $520/year of gift buffer is $20 a fortnight more outgoings, so the buffer drops.
    expect(bufferCents()).toBe(plain - 20_00)
  })

  it('wires the reset, discard, and exit handlers straight to the provider', () => {
    mockLoaded()
    renderSection()
    expect(hooks.screenProps?.onResetRow).toBe(hooks.planning.resetRow)
    expect(hooks.screenProps?.onDiscard).toBe(hooks.planning.resetAll)
    expect(hooks.screenProps?.onExit).toBe(hooks.planning.exit)
  })

  it('formats non-money fields, folds a re-edited new row, and reads the accrual inputs', () => {
    mockLoaded()
    localStorage.setItem('super-retirement-ages', JSON.stringify({ m1: 40 }))
    hooks.useHelpDebts.mockReturnValue({
      loading: false,
      helpDebts: [{ member_id: 'm1', balance_cents: 30_000_00 }],
    })
    hooks.useEquityGrants.mockReturnValue({
      loading: false,
      grants: [
        {
          member_id: 'm1',
          label: 'Shares',
          instrument_type: 'share',
          quantity: 10,
          grant_date: '2020-01-01',
          cliff_months: 0,
          vesting_period_months: 1,
          vesting_frequency: 'monthly',
          strike_price_cents: null,
          price_per_share_cents: 5_00,
        },
      ],
    })
    hooks.useSavers.mockReturnValue({
      loading: false,
      savers: [makeSaver({ id: 's1', balance_cents: 500_000 })],
    })
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [
        makeGoal({
          id: 'g1',
          name: 'House',
          target_amount_cents: 1_000_000,
          target_date: '2030-01-01',
          linked_account_id: 's1',
        }),
      ],
      baselineGoals: [
        makeGoal({
          id: 'g1',
          name: 'House',
          target_amount_cents: 1_000_000,
          linked_account_id: 's1',
        }),
      ],
    })
    const line = makeBudgetLine({
      id: 'bl1',
      goal_id: 'g1',
      amount_cents: 50_000,
      frequency: 'fortnightly',
    })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [line], baselineLines: [line] })
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [makeInflow({ id: 'i1', name: 'Renamed', taxable: false, interval_count: 3 })],
      baselineInflows: [makeInflow({ id: 'i1', name: 'Day job' })],
    })
    hooks.planning.layerFor.mockImplementation((table: string) =>
      table === 'inflows'
        ? {
            updates: {
              i1: { taxable: false, name: 'Renamed', interval_count: 3 },
              new1: { name: 'Adjusted' },
            },
            creates: [{ id: 'new1', name: 'Adjusted' }],
            deletes: [],
          }
        : undefined,
    )
    renderSection()

    const overrides = hooks.screenProps?.overrides as PlanningOverride[]
    // The re-edited new row folds into its single "New" entry, not a separate edit.
    expect(overrides.filter((o) => o.kind === 'create')).toHaveLength(1)
    const edit = overrides.find((o) => o.kind === 'update')!
    const byField = Object.fromEntries(edit.changes.map((c) => [c.field, c.now]))
    expect(byField).toMatchObject({ taxable: 'no', name: 'Renamed', interval_count: '3' })

    const goalEtas = hooks.screenProps?.goalEtas as PlanningGoalEta[]
    expect(goalEtas[0]?.name).toBe('House')
  })

  it('tolerates hooks that return no row arrays', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({ loading: false })
    hooks.useBudgetLines.mockReturnValue({ loading: false })
    hooks.useGoals.mockReturnValue({ loading: false })
    hooks.useSavers.mockReturnValue({ loading: false })
    hooks.useAccounts.mockReturnValue({ loading: false })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useSuperProfiles.mockReturnValue({ loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    hooks.useDeductions.mockReturnValue({ loading: false })
    hooks.useEquityGrants.mockReturnValue({ loading: false })
    hooks.useTemporaryItems.mockReturnValue({ loading: false })
    hooks.useGifts.mockReturnValue({ loading: false })
    hooks.useBreakdowns.mockReturnValue({ loading: false })
    renderSection()
    expect(hooks.screenProps?.overrides).toEqual([])
    expect(hooks.screenProps?.goalEtas).toEqual([])
  })
})
