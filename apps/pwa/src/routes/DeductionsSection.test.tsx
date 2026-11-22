import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '../test/render'
import { DeductionsSection } from './DeductionsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useCurrentMember: vi.fn(),
  useDeductions: vi.fn(),
  useDeductionGroups: vi.fn(),
  useDeductionReceipts: vi.fn(),
  useDeductedTransactionIds: vi.fn(),
  useSourceTransactions: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useCurrentMember', () => ({ useCurrentMember: hooks.useCurrentMember }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useDeductionGroups', () => ({ useDeductionGroups: hooks.useDeductionGroups }))
vi.mock('../hooks/useDeductionReceipts', () => ({
  useDeductionReceipts: hooks.useDeductionReceipts,
}))
vi.mock('../hooks/useDeductionTransactions', () => ({
  useDeductedTransactionIds: hooks.useDeductedTransactionIds,
  useSourceTransactions: hooks.useSourceTransactions,
}))
vi.mock('../components/DeductionsScreen', () => ({
  DeductionsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="deductions-screen" />
  },
}))

const TX = '5b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e'

function renderAt(path = '/deductions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DeductionsSection />
    </MemoryRouter>,
  )
}

/** Every read loaded and empty, so a test overrides only what it is about. */
function loadEverything() {
  hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
  hooks.useDeductions.mockReturnValue({ loading: false, deductions: [], create: vi.fn() })
  hooks.useDeductionGroups.mockReturnValue({ loading: false, groups: [] })
  hooks.useDeductionReceipts.mockReturnValue({ loading: false, receipts: [] })
}

describe('DeductionsSection', () => {
  beforeEach(() => {
    hooks.screenProps = null
    hooks.useCurrentMember.mockReturnValue({ member: { id: 'm1' }, loading: false })
    hooks.useDeductedTransactionIds.mockReturnValue({ ids: new Set<string>(), loading: false })
    hooks.useSourceTransactions.mockReturnValue({ transactions: {}, loading: false })
  })

  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useDeductions.mockReturnValue({ loading: false })
    hooks.useDeductionGroups.mockReturnValue({ loading: false })
    hooks.useDeductionReceipts.mockReturnValue({ loading: false })
    renderAt()
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the deductions screen with members, deductions, groups, and receipts', () => {
    const create = vi.fn()
    const createGroup = vi.fn()
    const updateGroup = vi.fn()
    const removeGroup = vi.fn()
    const update = vi.fn()
    const remove = vi.fn()
    const upload = vi.fn()
    const removeReceipt = vi.fn()
    const signedUrl = vi.fn()
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useDeductions.mockReturnValue({
      loading: false,
      deductions: [],
      financialYear: 2027,
      create,
      update,
      remove,
    })
    hooks.useDeductionGroups.mockReturnValue({
      loading: false,
      groups: [{ id: 'g1', name: 'Adobe Creative Cloud' }],
      create: createGroup,
      update: updateGroup,
      remove: removeGroup,
    })
    hooks.useDeductionReceipts.mockReturnValue({
      loading: false,
      receipts: [],
      upload,
      remove: removeReceipt,
      signedUrl,
    })
    renderAt()
    expect(screen.getByTestId('deductions-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Alex' }])
    expect(hooks.screenProps?.financialYear).toBe(2027)
    expect(hooks.screenProps?.currentMemberId).toBe('m1')
    expect(hooks.screenProps?.onCreate).toBe(create)
    expect(hooks.screenProps?.onUpdate).toBe(update)
    expect(hooks.screenProps?.onDelete).toBe(remove)
    expect(hooks.screenProps?.groups).toEqual([{ id: 'g1', name: 'Adobe Creative Cloud' }])
    expect(hooks.screenProps?.onCreateGroup).toBe(createGroup)
    expect(hooks.screenProps?.onUpdateGroup).toBe(updateGroup)
    expect(hooks.screenProps?.onDeleteGroup).toBe(removeGroup)
    expect(hooks.screenProps?.onUploadReceipt).toBe(upload)
    expect(hooks.screenProps?.onRemoveReceipt).toBe(removeReceipt)
    expect(hooks.screenProps?.signedUrl).toBe(signedUrl)
  })

  it('passes no current member until one resolves', () => {
    hooks.useCurrentMember.mockReturnValue({ member: null, loading: true })
    hooks.useMembers.mockReturnValue({ members: [], loading: false })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.useDeductionGroups.mockReturnValue({ loading: false, groups: [] })
    hooks.useDeductionReceipts.mockReturnValue({ loading: false, receipts: [] })
    renderAt()
    expect(hooks.screenProps?.currentMemberId).toBeNull()
  })

  describe('from a transaction', () => {
    const outflow = {
      id: TX,
      description: 'Bunnings',
      amount_cents: -120_00,
      posted_at: '2026-03-10T02:00:00+00:00',
    }

    it('opens the form prefilled and moves to the financial year of its date', async () => {
      loadEverything()
      hooks.useSourceTransactions.mockImplementation((ids: string[]) => ({
        transactions: ids.includes(TX) ? { [TX]: outflow } : {},
        loading: false,
      }))
      renderAt(`/deductions?transaction=${TX}`)

      await waitFor(() => expect(hooks.screenProps?.financialYear).toBe(2026))
      expect(hooks.screenProps?.fromTransaction).toEqual({
        transactionId: TX,
        description: 'Bunnings',
        amountCents: 120_00,
        deductionDate: '2026-03-10',
        financialYear: 2026,
      })
    })

    it('opens nothing for a transaction that already has a deduction', () => {
      loadEverything()
      hooks.useDeductedTransactionIds.mockReturnValue({ ids: new Set([TX]), loading: false })
      hooks.useSourceTransactions.mockReturnValue({
        transactions: { [TX]: outflow },
        loading: false,
      })
      renderAt(`/deductions?transaction=${TX}`)
      expect(hooks.screenProps?.fromTransaction).toBeNull()
    })

    it('opens nothing for an inflow', () => {
      loadEverything()
      hooks.useSourceTransactions.mockReturnValue({
        transactions: { [TX]: { ...outflow, amount_cents: 120_00 } },
        loading: false,
      })
      renderAt(`/deductions?transaction=${TX}`)
      expect(hooks.screenProps?.fromTransaction).toBeNull()
    })

    it('ignores a transaction id that is not a uuid', () => {
      loadEverything()
      renderAt('/deductions?transaction=nope')
      expect(hooks.useSourceTransactions).toHaveBeenCalledWith([])
      expect(hooks.screenProps?.fromTransaction).toBeNull()
    })

    it('looks up the source of each deduction created from a transaction', () => {
      loadEverything()
      hooks.useDeductions.mockReturnValue({
        loading: false,
        deductions: [
          { id: 'd1', transaction_id: TX },
          { id: 'd2', transaction_id: null },
        ],
      })
      renderAt()
      expect(hooks.useSourceTransactions).toHaveBeenCalledWith([TX])
    })
  })
})
