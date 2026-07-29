import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import { estimateHouseholdTaxFromRows } from '../lib/tax'
import {
  makeInflow,
  makeMember,
  makePayslip,
  makePayslipLine,
  makePayslipTaxLine,
} from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { PayslipsScreen } from './PayslipsScreen'

const config = FY2027_CONFIG
const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })
const inflow = makeInflow({ id: 'i1', name: 'Day job', amount_cents: 5_000_00 })
/** An on-call allowance projected at $450 a fortnight, on which no super accrues. */
const onCall = makeInflow({
  id: 'i2',
  name: 'On-call (T1)',
  amount_cents: 450_00,
  attracts_super: false,
})
const estimate = estimateHouseholdTaxFromRows([inflow], [], [], [], [], config)

/** Employer super exactly on the year's guarantee rate for `grossCents`. */
function superOnRate(grossCents: number) {
  return Math.round(grossCents * config.super.guaranteeRate)
}

function renderScreen(overrides: Partial<Parameters<typeof PayslipsScreen>[0]> = {}) {
  const props = {
    members: [will],
    payslips: [makePayslip()],
    lines: [makePayslipLine()],
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

/** One earnings-line group's row, found by the line labels it lists. */
function lineGroupRow(labels: string) {
  return screen.getByText(labels).closest('div')!.parentElement as HTMLElement
}

/** One of a payslip card's figure cells, found by its label. */
function figureCell(label: string) {
  return screen.getByText(label).parentElement as HTMLElement
}

/** A payslip card's disclosure button, found by the pay period it heads. */
function cardToggle(period = '1 July 2026 – 14 July 2026') {
  return screen.getByRole('button', { name: new RegExp(period) })
}

/** The detail region a card's toggle controls, found via its `aria-controls` target. */
function cardDetail(period?: string) {
  const id = cardToggle(period).getAttribute('aria-controls') ?? ''
  return document.getElementById(id) as HTMLElement
}

/** Cards start collapsed, so a test reading a slip's detail expands them first. */
async function expandCards(user: ReturnType<typeof userEvent.setup>) {
  for (const toggle of screen.getAllByRole('button', { expanded: false })) {
    await user.click(toggle)
  }
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

  it('heads a collapsed card with its pay period, payment date, and gross', () => {
    renderScreen()
    const toggle = cardToggle()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('1 July 2026 – 14 July 2026')
    expect(toggle).toHaveTextContent('Paid 15 July 2026')
    expect(toggle).toHaveTextContent('Gross')
    expect(toggle).toHaveTextContent('$5,000.00')
  })

  it('heads a slip that states no payment date on its pay period alone', async () => {
    const user = userEvent.setup()
    renderScreen({ payslips: [makePayslip({ paid_on: null })] })

    expect(cardToggle()).not.toHaveTextContent(/Paid/)
    expect(cardToggle()).toHaveTextContent('Gross')

    await user.click(cardToggle())
    expect(cardToggle()).not.toHaveTextContent(/Paid/)
  })

  it('keeps a slip’s figures and breakdowns behind its toggle until it is expanded', async () => {
    const user = userEvent.setup()
    renderScreen()

    expect(cardDetail()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Net')).not.toBeVisible()
    expect(screen.getByText('Earnings lines')).not.toBeVisible()

    await user.click(cardToggle())

    expect(cardToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(cardDetail()).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByText('Net')).toBeVisible()
    expect(screen.getByText('Earnings lines')).toBeVisible()
  })

  it('folds a card away again, restoring its headline', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(cardToggle())
    await user.click(cardToggle())

    expect(cardToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(cardDetail()).toHaveAttribute('aria-hidden', 'true')
    // The summary the expanded grid had taken over is back in the header.
    expect(cardToggle()).toHaveTextContent('Gross')
  })

  it('expands each card on its own', async () => {
    const user = userEvent.setup()
    renderScreen({
      payslips: [
        makePayslip(),
        makePayslip({ id: 'ps2', period_start: '2026-07-15', period_end: '2026-07-28' }),
      ],
    })

    await user.click(cardToggle('15 July 2026 – 28 July 2026'))

    expect(cardToggle('15 July 2026 – 28 July 2026')).toHaveAttribute('aria-expanded', 'true')
    expect(cardToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists each period’s quartet with the pay period it covers', async () => {
    const user = userEvent.setup()
    renderScreen()
    await expandCards(user)

    expect(screen.getByText('1 July 2026 – 14 July 2026')).toBeInTheDocument()
    expect(screen.getByText(/paid 15 July 2026/i)).toBeInTheDocument()
    expect(figureCell('Gross')).toHaveTextContent('$5,000.00')
    expect(figureCell('Tax withheld')).toHaveTextContent('$1,000.00')
    expect(figureCell('Net')).toHaveTextContent('$4,000.00')
  })

  it('reads a slip that earned and withheld more than the plan as above plan', async () => {
    const user = userEvent.setup()
    renderScreen({
      payslips: [makePayslip({ gross_cents: 20_000_00, tax_withheld_cents: 9_000_00 })],
    })

    // The gross overrun dwarfs the others, so it is what the collapsed card leads
    // with — unnamed, since the figure above it is the gross itself.
    expect(cardToggle()).toHaveTextContent(/above plan/)
    expect(cardToggle()).not.toHaveTextContent(/Tax withheld/)

    await expandCards(user)
    expect(figureCell('Gross')).toHaveTextContent(/above plan/)
    expect(figureCell('Tax withheld')).toHaveTextContent(/above plan/)
  })

  it('reads a slip that earned and withheld less than the plan as below plan', async () => {
    const user = userEvent.setup()
    renderScreen({
      payslips: [makePayslip({ gross_cents: 1_000_00, tax_withheld_cents: 0 })],
    })
    await expandCards(user)
    expect(figureCell('Gross')).toHaveTextContent(/below plan/)
    expect(figureCell('Tax withheld')).toHaveTextContent(/below plan/)
  })

  it('names the figure when a collapsed card leads with a variance other than gross', () => {
    // The slip's gross is exactly the projection, so the withholding shortfall is
    // the only thing off plan — and the one thing worth noticing from the outside.
    renderScreen()
    expect(cardToggle()).toHaveTextContent('Tax withheld')
    expect(cardToggle()).toHaveTextContent(/below plan/)
  })

  it('reads super paid at the guarantee rate as on plan, sacrifice included', async () => {
    const user = userEvent.setup()
    renderScreen({
      payslips: [
        makePayslip({
          gross_cents: 5_000_00,
          super_cents: superOnRate(5_000_00) - 50_00,
          salary_sacrifice_cents: 50_00,
        }),
      ],
    })
    await expandCards(user)
    expect(figureCell('Super')).toHaveTextContent('On plan')
  })

  it('reads a fortnight matching the inflow its lines draw on as on plan', async () => {
    const user = userEvent.setup()
    renderScreen()
    await expandCards(user)
    expect(figureCell('Gross')).toHaveTextContent('On plan')
    expect(screen.queryByText(/share of a whole pay period/i)).not.toBeInTheDocument()
  })

  it('says when a part period’s expectations are a share of a whole pay period', async () => {
    const user = userEvent.setup()
    renderScreen({ payslips: [makePayslip({ period_end: '2026-07-07' })] })
    await expandCards(user)
    expect(screen.getByText(/share of a whole pay period/i)).toBeVisible()
  })

  it('measures each tax line against the component of the liability it pays', async () => {
    const user = userEvent.setup()
    // The estimate's liability carries no HELP repayment for this member, so the
    // PAYG line is held against the whole of it and the STSL against nothing.
    renderScreen({
      payslips: [makePayslip({ tax_withheld_cents: 1_850_00 })],
      lines: [
        makePayslipLine(),
        makePayslipTaxLine({ id: 'pt1', label: 'PAYG', amount_cents: 1_416_00 }),
        makePayslipTaxLine({
          id: 'pt2',
          label: 'STSL Component',
          tax_component: 'stsl',
          amount_cents: 434_00,
        }),
      ],
    })
    await expandCards(user)

    expect(screen.getByText('Tax lines')).toBeVisible()
    expect(lineGroupRow('PAYG')).toHaveTextContent('PAYG income tax')
    expect(lineGroupRow('PAYG')).toHaveTextContent('$1,416.00')
    const stsl = lineGroupRow('STSL Component')
    expect(stsl).toHaveTextContent('STSL (study loan)')
    expect(stsl).toHaveTextContent('$434.00 above plan')
  })

  it('calls out withheld tax the tax lines do not account for', async () => {
    const user = userEvent.setup()
    renderScreen({
      lines: [
        makePayslipLine(),
        makePayslipTaxLine({ id: 'pt1', label: 'PAYG', amount_cents: 900_00 }),
      ],
    })
    await expandCards(user)
    expect(screen.getByText(/of the tax withheld is not itemised/)).toHaveTextContent('$100.00')
  })

  it('calls out tax lines summing past the withheld total', async () => {
    const user = userEvent.setup()
    renderScreen({
      lines: [
        makePayslipLine(),
        makePayslipTaxLine({ id: 'pt1', label: 'PAYG', amount_cents: 1_100_00 }),
      ],
    })
    await expandCards(user)
    expect(screen.getByText(/more than the tax withheld is itemised/)).toHaveTextContent('$100.00')
  })

  it('shows no tax breakdown for a slip whose tax nobody has itemised', async () => {
    const user = userEvent.setup()
    renderScreen()
    await expandCards(user)
    expect(screen.queryByText('Tax lines')).not.toBeInTheDocument()
  })

  it('says there is no projection to compare when no line names one', async () => {
    const user = userEvent.setup()
    renderScreen({ lines: [makePayslipLine({ source_inflow_id: null })] })
    await expandCards(user)
    expect(figureCell('Gross')).toHaveTextContent('No projection to compare')
    // With no pay cycle to read there is no pay period a share could be of, so the
    // part-period note says nothing rather than stating the obvious.
    expect(screen.queryByText(/share of a whole pay period/i)).not.toBeInTheDocument()
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

  it('shows a slip’s note', async () => {
    const user = userEvent.setup()
    renderScreen({ payslips: [makePayslip({ note: 'Includes back-pay' })] })
    await expandCards(user)
    expect(screen.getByText('Includes back-pay')).toBeVisible()
  })

  it('opens a stored document in a new tab via its signed URL', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { signedUrl } = renderScreen({
      payslips: [makePayslip({ file_path: 'h1/ps1/slip.pdf' })],
    })
    await expandCards(user)

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
    await expandCards(user)

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
        id: expect.any(String),
        input: expect.objectContaining({ member_id: 'm1', gross_cents: 5_000_00 }),
        lines: [],
        attachment: null,
      }),
    )
  })

  it('edits a payslip in place and saves the change', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen()

    // Edit sits outside the disclosure, so correcting a slip takes no expanding.
    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('ps1', {
        // The slip's own id, so the save rewrites it rather than adding another.
        id: 'ps1',
        input: expect.objectContaining({ period_end: '2026-07-14' }),
        // The slip's own lines come back with it, unchanged.
        lines: [
          {
            kind: 'earning',
            source_inflow_id: 'i1',
            tax_component: null,
            label: 'Ordinary Hours',
            amount_cents: 5_000_00,
          },
        ],
        attachment: null,
      }),
    )
  })

  it('confirms before deleting a payslip', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderScreen()

    // Delete sits outside the disclosure too, beside the edit pencil.
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('1 July 2026 – 14 July 2026')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('ps1')
  })

  it('breaks an itemised slip down by the inflow each earning draws on', async () => {
    const user = userEvent.setup()
    // The real Heidi slip: ordinary hours and annual leave both draw on the
    // salary and land on plan, while the on-call allowance carries the variance.
    renderScreen({
      inflows: [inflow, onCall],
      payslips: [makePayslip({ gross_cents: 5_495_50 })],
      lines: [
        makePayslipLine({ id: 'pl1', label: 'Ordinary Hours', amount_cents: 4_000_00 }),
        makePayslipLine({ id: 'pl2', label: 'Annual Leave', amount_cents: 1_000_00 }),
        makePayslipLine({
          id: 'pl3',
          label: 'On-call',
          amount_cents: 495_50,
          source_inflow_id: 'i2',
          attracts_super: false,
        }),
      ],
    })
    await expandCards(user)

    expect(screen.getByText('Earnings lines')).toBeVisible()
    // The salary group is on plan; the allowance's $45.50 overrun stands alone.
    const salary = lineGroupRow('Ordinary Hours, Annual Leave')
    expect(salary).toHaveTextContent('Day job')
    expect(salary).toHaveTextContent('$5,000.00')
    expect(salary).toHaveTextContent('On plan')
    const allowance = lineGroupRow('On-call')
    expect(allowance).toHaveTextContent('On-call (T1)')
    expect(allowance).toHaveTextContent('$45.50 above plan')
    // The employer's $600 is 12% of the $5,000 salary, not of the $5,495.50
    // gross: charging the rate on the allowance too would read $59.46 below plan.
    expect(figureCell('Super')).toHaveTextContent('On plan')
  })

  it('names a group of lines mapped to no inflow as unmapped', async () => {
    const user = userEvent.setup()
    renderScreen({
      payslips: [makePayslip({ gross_cents: 5_495_50 })],
      lines: [
        makePayslipLine({ id: 'pl1', amount_cents: 5_000_00 }),
        makePayslipLine({
          id: 'pl2',
          label: 'Bonus',
          amount_cents: 495_50,
          source_inflow_id: null,
        }),
      ],
    })
    await expandCards(user)
    expect(screen.getByText('Not mapped to an inflow')).toBeVisible()
    expect(screen.getAllByText('No projection to compare')).not.toHaveLength(0)
  })

  it('calls out gross the lines do not account for', async () => {
    const user = userEvent.setup()
    renderScreen({
      payslips: [makePayslip({ gross_cents: 5_495_50 })],
      lines: [makePayslipLine({ amount_cents: 5_000_00 })],
    })
    await expandCards(user)
    expect(screen.getByText(/of the gross is not itemised/)).toHaveTextContent('$495.50')
  })

  it('calls out earnings lines summing past the gross', async () => {
    const user = userEvent.setup()
    renderScreen({ lines: [makePayslipLine({ amount_cents: 5_495_50 })] })
    await expandCards(user)
    expect(screen.getByText(/more than the gross is itemised/)).toHaveTextContent('$495.50')
  })

  it('shows no breakdown for a slip nobody has itemised', async () => {
    const user = userEvent.setup()
    renderScreen({ lines: [] })
    await expandCards(user)
    expect(screen.queryByText('Earnings lines')).not.toBeInTheDocument()
    expect(figureCell('Gross')).toHaveTextContent('No projection to compare')
  })

  it('opens the edit form on the slip’s own lines', async () => {
    const user = userEvent.setup()
    renderScreen({
      lines: [
        makePayslipLine({ id: 'pl1', label: 'Ordinary Hours', amount_cents: 4_000_00 }),
        makePayslipLine({ id: 'pl2', payslip_id: 'ps2', label: 'Someone else’s line' }),
      ],
    })

    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Ordinary Hours')
    expect(screen.queryByLabelText('Earnings line 2 name')).not.toBeInTheDocument()
  })

  it('keeps each member’s slips under their own heading', () => {
    renderScreen({
      members: [will, sam],
      payslips: [makePayslip(), makePayslip({ id: 'ps2', member_id: 'm2', gross_cents: 900_00 })],
    })
    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getAllByText('1 payslip')).toHaveLength(2)
    // Sam's card heads with their own gross, and their year-to-date gross sums to
    // it. Will's slip is on the same period, so the two cards are told apart by
    // the order their members render in.
    const [, samCard] = screen.getAllByRole('button', { expanded: false })
    expect(samCard).toHaveTextContent('$900.00')
    expect(screen.getAllByText('YTD gross')[1]!.parentElement).toHaveTextContent('$900.00')
  })
})
