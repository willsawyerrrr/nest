import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import { estimateHouseholdTaxFromRows } from '../lib/tax'
import { makeInflow, makeMember, makePayslip } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { PayslipsScreen } from './PayslipsScreen'

const config = FY2027_CONFIG
const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })
const inflow = makeInflow({ id: 'i1', name: 'Day job', amount_cents: 5_000_00 })
const estimate = estimateHouseholdTaxFromRows([inflow], [], [], [], [], config)

/** Employer super exactly on the year's guarantee rate for `grossCents`. */
function superOnRate(grossCents: number) {
  return Math.round(grossCents * config.super.guaranteeRate)
}

function renderScreen(overrides: Partial<Parameters<typeof PayslipsScreen>[0]> = {}) {
  const props = {
    members: [will],
    payslips: [makePayslip()],
    inflows: [inflow],
    financialYear: 2027,
    estimate,
    config,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    signedUrl: vi.fn().mockResolvedValue('https://signed/url'),
    attachments: { upload: vi.fn(), discard: vi.fn(), read: vi.fn() },
    ...overrides,
  }
  render(<PayslipsScreen {...props} />)
  return props
}

/** One of a payslip card's figure cells, found by its label. */
function figureCell(label: string) {
  return screen.getByText(label).parentElement as HTMLElement
}

afterEach(() => vi.restoreAllMocks())

describe('PayslipsScreen', () => {
  it('heads the page with the financial year and how withholding reads', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'Payslips (FY2027)' })).toBeInTheDocument()
    expect(screen.getByText(/points to a refund, not a problem/i)).toBeInTheDocument()
  })

  it('shows an empty hint per member without payslips', () => {
    renderScreen({ members: [will, sam], payslips: [] })
    expect(screen.getAllByText(/no payslips yet/i)).toHaveLength(2)
  })

  it('lists each period’s quartet with the pay period and reconciled inflow', () => {
    renderScreen()
    expect(screen.getByText('1 July 2026 – 14 July 2026')).toBeInTheDocument()
    expect(screen.getByText(/paid 15 July 2026/i)).toBeInTheDocument()
    expect(screen.getByText('Day job')).toBeInTheDocument()
    expect(figureCell('Gross')).toHaveTextContent('$5,000.00')
    expect(figureCell('Tax withheld')).toHaveTextContent('$1,000.00')
    expect(figureCell('Net')).toHaveTextContent('$4,000.00')
  })

  it('reads a slip that earned and withheld more than the plan as above plan', () => {
    renderScreen({
      payslips: [makePayslip({ gross_cents: 20_000_00, tax_withheld_cents: 9_000_00 })],
    })
    expect(figureCell('Gross')).toHaveTextContent(/above plan/)
    expect(figureCell('Tax withheld')).toHaveTextContent(/above plan/)
  })

  it('reads a slip that earned and withheld less than the plan as below plan', () => {
    renderScreen({
      payslips: [makePayslip({ gross_cents: 1_000_00, tax_withheld_cents: 0 })],
    })
    expect(figureCell('Gross')).toHaveTextContent(/below plan/)
    expect(figureCell('Tax withheld')).toHaveTextContent(/below plan/)
  })

  it('reads super paid at the guarantee rate as on plan, sacrifice included', () => {
    renderScreen({
      payslips: [
        makePayslip({
          gross_cents: 5_000_00,
          super_cents: superOnRate(5_000_00) - 50_00,
          salary_sacrifice_cents: 50_00,
        }),
      ],
    })
    expect(figureCell('Super')).toHaveTextContent('On plan')
  })

  it('reads a fortnight matching its fortnightly inflow as on plan', () => {
    renderScreen()
    expect(figureCell('Gross')).toHaveTextContent('On plan')
    expect(screen.queryByText(/apportioned by calendar days/i)).not.toBeInTheDocument()
  })

  it('says when a part period’s expectations are apportioned by calendar days', () => {
    renderScreen({ payslips: [makePayslip({ period_end: '2026-07-07' })] })
    expect(screen.getByText(/apportioned by calendar days/i)).toBeInTheDocument()
  })

  it('says there is no projection to compare when a slip reconciles against no inflow', () => {
    renderScreen({ payslips: [makePayslip({ source_inflow_id: null })] })
    expect(figureCell('Gross')).toHaveTextContent('No projection to compare')
    expect(screen.queryByText('Day job')).not.toBeInTheDocument()
  })

  it('sums the member’s year-to-date actuals and counts the slips', () => {
    renderScreen({
      payslips: [makePayslip(), makePayslip({ id: 'ps2', period_end: '2026-07-28' })],
    })
    expect(screen.getByText('2 payslips')).toBeInTheDocument()
    expect(figureCell('YTD gross')).toHaveTextContent('$10,000.00')
    expect(figureCell('YTD withheld')).toHaveTextContent('$2,000.00')
    expect(figureCell('YTD super')).toHaveTextContent('$1,200.00')
  })

  it('flags a slip’s reported year to date running ahead of the slips entered', () => {
    renderScreen({
      payslips: [
        makePayslip({
          ytd_gross_cents: 15_000_00,
          ytd_tax_withheld_cents: 3_000_00,
          ytd_super_cents: 1_800_00,
        }),
      ],
    })
    expect(screen.getByText('1 payslip')).toBeInTheDocument()
    expect(screen.getByText(/more than the slips entered here/i)).toHaveTextContent('$10,000.00')
  })

  it('flags a slip’s reported year to date running behind the slips entered', () => {
    renderScreen({
      payslips: [
        makePayslip({
          ytd_gross_cents: 1_000_00,
          ytd_tax_withheld_cents: 200_00,
          ytd_super_cents: 120_00,
        }),
      ],
    })
    expect(screen.getByText(/less than the slips entered here/i)).toBeInTheDocument()
  })

  it('says nothing when a slip’s reported year to date matches the slips entered', () => {
    renderScreen({
      payslips: [
        makePayslip({
          ytd_gross_cents: 5_000_00,
          ytd_tax_withheld_cents: 1_000_00,
          ytd_super_cents: 600_00,
        }),
      ],
    })
    expect(screen.queryByText(/the slips entered here/i)).not.toBeInTheDocument()
  })

  it('shows a slip’s note', () => {
    renderScreen({ payslips: [makePayslip({ note: 'Includes back-pay' })] })
    expect(screen.getByText('Includes back-pay')).toBeInTheDocument()
  })

  it('opens a stored document in a new tab via its signed URL', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { signedUrl } = renderScreen({
      payslips: [makePayslip({ file_path: 'h1/ps1/slip.pdf' })],
    })

    await user.click(screen.getByRole('button', { name: /view payslip document/i }))

    expect(signedUrl).toHaveBeenCalledWith('h1/ps1/slip.pdf')
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://signed/url', '_blank', 'noopener'),
    )
  })

  it('leaves the tab closed when the document cannot be signed', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderScreen({
      payslips: [makePayslip({ file_path: 'h1/ps1/slip.pdf' })],
      signedUrl: vi.fn().mockResolvedValue(null),
    })

    await user.click(screen.getByRole('button', { name: /view payslip document/i }))

    await waitFor(() => expect(open).not.toHaveBeenCalled())
  })

  it('adds a payslip for the member, passing the attachment alongside', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderScreen({ payslips: [] })

    await user.click(screen.getByRole('button', { name: /add payslip/i }))
    await user.type(screen.getByLabelText('Gross'), '5000')
    await user.type(screen.getByLabelText('Tax withheld'), '1000')
    await user.type(screen.getByLabelText('Super'), '600')
    await user.type(screen.getByLabelText('Net'), '4000')
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        input: expect.objectContaining({ member_id: 'm1', gross_cents: 5_000_00 }),
        attachment: null,
      }),
    )
  })

  it('edits a payslip in place and saves the change', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen()

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('ps1', {
        input: expect.objectContaining({ period_end: '2026-07-14' }),
        attachment: null,
      }),
    )
  })

  it('confirms before deleting a payslip', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderScreen()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('1 July 2026 – 14 July 2026')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('ps1')
  })

  it('keeps each member’s slips under their own heading', () => {
    renderScreen({
      members: [will, sam],
      payslips: [makePayslip(), makePayslip({ id: 'ps2', member_id: 'm2', gross_cents: 900_00 })],
    })
    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getAllByText('1 payslip')).toHaveLength(2)
    // Sam's own gross, and their year-to-date gross summed from that one slip.
    expect(screen.getAllByText('$900.00')).toHaveLength(2)
  })
})
