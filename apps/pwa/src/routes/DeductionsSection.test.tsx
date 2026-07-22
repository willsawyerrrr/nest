import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { DeductionsSection } from './DeductionsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useDeductions: vi.fn(),
  useDeductionReceipts: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useDeductionReceipts', () => ({
  useDeductionReceipts: hooks.useDeductionReceipts,
}))
vi.mock('../components/DeductionsScreen', () => ({
  DeductionsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="deductions-screen" />
  },
}))

describe('DeductionsSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useDeductions.mockReturnValue({ loading: false })
    hooks.useDeductionReceipts.mockReturnValue({ loading: false })
    render(<DeductionsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the deductions screen with members, deductions, and receipts', () => {
    const create = vi.fn()
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
    hooks.useDeductionReceipts.mockReturnValue({
      loading: false,
      receipts: [],
      upload,
      remove: removeReceipt,
      signedUrl,
    })
    render(<DeductionsSection householdId="h1" />)
    expect(screen.getByTestId('deductions-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Alex' }])
    expect(hooks.screenProps?.financialYear).toBe(2027)
    expect(hooks.screenProps?.onCreate).toBe(create)
    expect(hooks.screenProps?.onUpdate).toBe(update)
    expect(hooks.screenProps?.onDelete).toBe(remove)
    expect(hooks.screenProps?.onUploadReceipt).toBe(upload)
    expect(hooks.screenProps?.onRemoveReceipt).toBe(removeReceipt)
    expect(hooks.screenProps?.signedUrl).toBe(signedUrl)
  })
})
