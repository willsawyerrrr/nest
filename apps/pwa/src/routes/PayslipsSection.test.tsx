import { describe, expect, it, vi } from 'vitest'
import type { PayslipInput, PayslipSubmission } from '../hooks/usePayslips'
import { makeInflow, makePayslip } from '../test/fixtures'
import { render, screen } from '../test/render'
import { PayslipsSection } from './PayslipsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useInflows: vi.fn(),
  usePayslips: vi.fn(),
  useTaxProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useHelpDebts: vi.fn(),
  useDeductions: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/usePayslips', () => ({ usePayslips: hooks.usePayslips }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../components/PayslipsScreen', () => ({
  PayslipsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="payslips-screen" />
  },
}))

const submission: PayslipSubmission = {
  input: { member_id: 'm1' } as PayslipInput,
  attachment: { payslipId: 'ps1', path: 'h1/ps1/slip.pdf' },
}

/** Stubs every hook as loaded, returning the payslip hook's own mocks. */
function stubHooks(payslips = [makePayslip()]) {
  const create = vi.fn().mockResolvedValue(undefined)
  const update = vi.fn().mockResolvedValue(undefined)
  const remove = vi.fn().mockResolvedValue(undefined)
  const signedUrl = vi.fn()
  const attachments = { upload: vi.fn(), discard: vi.fn(), read: vi.fn() }
  hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Will' }], loading: false })
  hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
  hooks.usePayslips.mockReturnValue({
    loading: false,
    payslips,
    financialYear: 2027,
    create,
    update,
    remove,
    signedUrl,
    attachments,
  })
  hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [] })
  hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
  hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
  hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
  return { create, update, remove, signedUrl, attachments }
}

describe('PayslipsSection', () => {
  it('shows the loading screen until data loads', () => {
    stubHooks()
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    render(<PayslipsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the screen with the members, payslips, inflows, and estimate', () => {
    const { signedUrl, attachments } = stubHooks()
    render(<PayslipsSection householdId="h1" />)

    expect(screen.getByTestId('payslips-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Will' }])
    expect(hooks.screenProps?.payslips).toEqual([makePayslip()])
    expect(hooks.screenProps?.financialYear).toBe(2027)
    expect(hooks.screenProps?.signedUrl).toBe(signedUrl)
    expect(hooks.screenProps?.attachments).toBe(attachments)
    // The estimate the per-period expectations are prorated from.
    expect(hooks.screenProps?.estimate).toMatchObject({ annualGrossCents: expect.any(Number) })
    expect(hooks.screenProps?.config).toMatchObject({ super: expect.any(Object) })
  })

  it('saves and removes through the payslip hook, attachment included', async () => {
    const { create, update, remove } = stubHooks()
    render(<PayslipsSection householdId="h1" />)

    const onCreate = hooks.screenProps?.onCreate as (s: PayslipSubmission) => Promise<void>
    const onUpdate = hooks.screenProps?.onUpdate as (
      id: string,
      s: PayslipSubmission,
    ) => Promise<void>
    await onCreate(submission)
    await onUpdate('ps1', submission)

    expect(create).toHaveBeenCalledWith(submission.input, submission.attachment)
    expect(update).toHaveBeenCalledWith('ps1', submission.input, submission.attachment)
    expect(hooks.screenProps?.onDelete).toBe(remove)
  })
})
