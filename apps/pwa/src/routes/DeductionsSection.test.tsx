import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { DeductionsSection } from './DeductionsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useDeductions: vi.fn(),
  useDeductionGroups: vi.fn(),
  useDeductionReceipts: vi.fn(),
  useDocumentIntake: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useDeductionGroups', () => ({ useDeductionGroups: hooks.useDeductionGroups }))
vi.mock('../hooks/useDeductionReceipts', () => ({
  useDeductionReceipts: hooks.useDeductionReceipts,
}))
vi.mock('../hooks/useDocumentIntake', () => ({ useDocumentIntake: hooks.useDocumentIntake }))
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
    hooks.useDeductionGroups.mockReturnValue({ loading: false })
    hooks.useDeductionReceipts.mockReturnValue({ loading: false })
    hooks.useDocumentIntake.mockReturnValue({ loading: false })
    render(<DeductionsSection householdId="h1" />)
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
    hooks.useDocumentIntake.mockReturnValue({
      loading: false,
      items: [],
      download: vi.fn(),
      clear: vi.fn(),
    })
    render(<DeductionsSection householdId="h1" />)
    expect(screen.getByTestId('deductions-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Alex' }])
    expect(hooks.screenProps?.financialYear).toBe(2027)
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
})
