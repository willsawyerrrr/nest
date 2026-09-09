import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayslip, makePayslipLine, makePayslipTaxLine } from '../test/fixtures'
import {
  attachments,
  earningLine,
  fillQuartet,
  inflows,
  member,
  renderForm,
  resetPayslipAttachmentMocks,
  submitted,
} from '../test/payslipForm'
import { render, screen, waitFor } from '../test/render'
import { PayslipForm } from './PayslipForm'

beforeEach(resetPayslipAttachmentMocks)

describe('PayslipForm', () => {
  it('submits the quartet in cents with the financial year derived from the payment date', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({
          period_start: '2026-06-17',
          period_end: '2026-06-30',
          paid_on: '2026-07-01',
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit)).toEqual({
      // The slip being edited keeps its own id, so a save rewrites it.
      id: 'ps1',
      input: {
        member_id: 'm1',
        // Derived from the payment date, not typed: the fortnight was worked to
        // 30 June but the pay landed on 1 July, which is FY2027.
        financial_year: 2027,
        period_start: '2026-06-17',
        period_end: '2026-06-30',
        paid_on: '2026-07-01',
        gross_cents: 5_000_00,
        tax_withheld_cents: 1_000_00,
        super_cents: 600_00,
        net_cents: 4_000_00,
        salary_sacrifice_cents: null,
        ytd_gross_cents: null,
        ytd_tax_withheld_cents: null,
        ytd_super_cents: null,
        note: null,
      },
      lines: [],
      attachment: null,
    })
  })

  it('names the date the derived financial year came from and offers no field to type it in', () => {
    // No payment date: the pay period end decides, and the note says to enter one.
    const { unmount } = render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({
          period_start: '2026-06-17',
          period_end: '2026-06-30',
          paid_on: null,
        })}
        onSubmit={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/filed under fy2026, derived from the pay period end\./i),
    ).toHaveTextContent(/entering a payment date files the slip by that instead/i)
    expect(screen.queryByLabelText(/financial year/i)).not.toBeInTheDocument()
    unmount()

    // The same fortnight, paid 1 July: the payment date carries it into FY2027.
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({
          period_start: '2026-06-17',
          period_end: '2026-06-30',
          paid_on: '2026-07-01',
        })}
        onSubmit={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/filed under fy2027, derived from the payment date/i),
    ).toBeInTheDocument()
  })

  it('says the withheld figure is the slip’s tax total, STSL included', () => {
    // A slip prints PAYG and STSL separately under one tax total; the estimate's
    // liability already carries the HELP repayment the STSL pays, so typing the
    // PAYG line alone overstates the bill by the STSL.
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/slip’s tax total/i)).toHaveTextContent(/STSL/)
    expect(screen.getByText(/slip’s tax total/i)).toHaveTextContent(/not the PAYG line alone/i)
  })

  it('offers no slip-wide inflow to reconcile against: the lines carry that', () => {
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: /reconciles against/i })).not.toBeInTheDocument()
  })

  it('records the typed note', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({ note: '  ' })}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Note'), 'Includes back-pay')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.note).toBe('Includes back-pay')
  })

  it('trims a note that is only whitespace away to nothing', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({ note: '  ' })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.note).toBeNull()
  })

  it('blocks a submit while the pay period is incomplete', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip()}
        onSubmit={onSubmit}
      />,
    )

    await user.clear(screen.getByLabelText('Period start'))
    await user.clear(screen.getByLabelText('Paid on'))
    await user.clear(screen.getByLabelText('Period end'))
    await user.tab()

    expect(screen.queryByText(/filed under fy/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('rejects a pay period ending before it starts, without submitting', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({ period_start: '2026-07-14', period_end: '2026-07-01' })}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByText('Must be on or after the period start.')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /save changes/i })
    expect(submit).toBeDisabled()

    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says a new document replaces the one already attached', () => {
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({ file_path: 'h1/ps1/slip.pdf' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/replaces the document already attached/i)).toBeInTheDocument()
  })

  it('holds the salary sacrifice and year-to-date figures a slip reports', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({
          salary_sacrifice_cents: 100_00,
          ytd_gross_cents: 20_000_00,
          ytd_tax_withheld_cents: 4_000_00,
          ytd_super_cents: 2_400_00,
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input).toMatchObject({
      salary_sacrifice_cents: 100_00,
      ytd_gross_cents: 20_000_00,
      ytd_tax_withheld_cents: 4_000_00,
      ytd_super_cents: 2_400_00,
    })
  })

  it('defaults a new slip to the fortnight ending today and can be cancelled', async () => {
    const user = userEvent.setup({ delay: null })
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )

    // Nothing is entered yet, so the add action stays disabled.
    expect(screen.getByRole('button', { name: /add payslip/i })).toBeDisabled()

    await user.type(screen.getByLabelText('Gross'), '1000')
    await user.type(screen.getByLabelText('Tax withheld'), '200')
    await user.type(screen.getByLabelText('Super'), '120')
    await user.type(screen.getByLabelText('Net'), '800')
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const { input } = submitted(onSubmit)
    expect(input).toMatchObject({
      gross_cents: 1_000_00,
      tax_withheld_cents: 200_00,
      super_cents: 120_00,
      net_cents: 800_00,
      paid_on: null,
    })
    // Thirteen days back from the end day makes an inclusive fortnight.
    const days =
      (Date.parse(`${input.period_end}T00:00:00Z`) -
        Date.parse(`${input.period_start}T00:00:00Z`)) /
      86_400_000
    expect(days).toBe(13)
    // Nothing was typed into "Paid on", so the defaulted period end files the slip.
    expect(
      screen.getByText(
        new RegExp(`Filed under FY${input.financial_year}, derived from the pay period end\\.`),
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('PayslipForm earnings lines', () => {
  /** Fills line `position` with a name, an amount, and optionally an inflow. */
  async function fillLine(
    user: ReturnType<typeof userEvent.setup>,
    position: number,
    label: string,
    amount: string,
    inflow?: string,
  ) {
    await user.type(screen.getByLabelText(`Earnings line ${position} name`), label)
    await user.type(screen.getByLabelText(`Earnings line ${position} amount`), amount)
    if (inflow !== undefined) {
      await user.click(screen.getByRole('combobox', { name: `Earnings line ${position} draws on` }))
      await user.click(await screen.findByRole('option', { name: inflow }))
    }
  }

  it('opens with no lines, and explains what itemising is for', () => {
    renderForm()
    expect(screen.getByText('Earnings lines')).toBeInTheDocument()
    expect(screen.getByText(/an allowance that earns no super/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Earnings line 1 name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tax line 1 name')).not.toBeInTheDocument()
  })

  it('submits a salary split across two lines alongside an on-call allowance', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = renderForm()

    await fillQuartet(user)
    for (const _ of [0, 1, 2]) {
      await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    }
    await fillLine(user, 1, 'Ordinary Hours', '4000', 'Day job')
    await fillLine(user, 2, 'Annual Leave', '1000', 'Day job')
    await fillLine(user, 3, 'On-call (T1)', '495.50')
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([
      earningLine('i1', 'Ordinary Hours', 4_000_00),
      earningLine('i1', 'Annual Leave', 1_000_00),
      earningLine(null, 'On-call (T1)', 495_50),
    ])
  })

  it('offers only the member’s own taxable inflows to draw a line on', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.click(screen.getByRole('combobox', { name: 'Earnings line 1 draws on' }))

    expect(await screen.findByRole('option', { name: 'Day job' })).toBeInTheDocument()
    // An allowance is offered like any other taxable inflow: it is taxed in
    // full, and earning no super is the super side's business, not the picker's.
    expect(screen.getByRole('option', { name: 'On-call (T1)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Side job' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Gift money' })).not.toBeInTheDocument()
  })

  it('draws a line on an allowance that earns no super', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = renderForm()

    await fillQuartet(user, '5495.50')
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '5000', 'Day job')
    await fillLine(user, 2, 'On-call (T1)', '495.50', 'On-call (T1)')
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([
      earningLine('i1', 'Ordinary Hours', 5_000_00),
      earningLine('i4', 'On-call (T1)', 495_50),
    ])
  })

  it('says so when the member has no taxable inflow a line could draw on', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm({ inflows: [] })

    await user.click(screen.getByRole('button', { name: /add earnings line/i }))

    expect(screen.getByRole('combobox', { name: 'Earnings line 1 draws on' })).toHaveAttribute(
      'placeholder',
      'No taxable inflows',
    )
  })

  it('reports the gross the lines account for, and the gap when they do not', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '5000')
    expect(screen.getByText(/of the gross is not itemised/i)).toHaveTextContent('$495.50')

    await user.clear(screen.getByLabelText('Earnings line 1 amount'))
    await user.type(screen.getByLabelText('Earnings line 1 amount'), '6000')
    expect(screen.getByText(/more than the gross is itemised/i)).toHaveTextContent('$504.50')
  })

  it('warns when more of the gross is left out than the mapped lines account for', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    // Itemising only the allowance and leaving the salary untyped collapses the
    // expected gross to the allowance, giving a phantom variance the size of the
    // salary — the trap this warning exists to catch.
    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'On-call (T1)', '495.50', 'On-call (T1)')

    expect(screen.getByText(/more of the gross is unitemised/i)).toHaveTextContent('$5,000.00')
  })

  it('leaves the warning off while the lines account for most of the gross', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '5000', 'Day job')

    expect(screen.queryByText(/more of the gross is unitemised/i)).not.toBeInTheDocument()
  })

  it('leaves the warning off when no line names a projection to measure against', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    // Nothing maps to a projection, so the expected gross is null rather than
    // understated: there is no phantom variance to warn about.
    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'On-call (T1)', '495.50')

    expect(screen.queryByText(/more of the gross is unitemised/i)).not.toBeInTheDocument()
  })

  it('says every dollar is itemised once the lines sum to the gross', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await fillQuartet(user, '5000')
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '5000')

    expect(screen.getByText(/every dollar is itemised/i)).toBeInTheDocument()
  })

  it('removes a line, leaving the rows beside it as they were', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '4000')
    await fillLine(user, 2, 'Annual Leave', '1000')
    await user.click(screen.getByRole('button', { name: 'Remove earnings line 1' }))

    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Annual Leave')
    expect(screen.queryByLabelText('Earnings line 2 name')).not.toBeInTheDocument()
  })

  it('blocks the save while a line is half filled in', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.type(screen.getByLabelText('Earnings line 1 name'), 'Ordinary Hours')

    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeDisabled()

    await user.type(screen.getByLabelText('Earnings line 1 amount'), '5495.50')
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeEnabled()
  })

  it('drops a row left entirely blank rather than blocking the save on it', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([])
  })

  it('opens an itemised slip with its saved lines, and saves them back', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = renderForm({
      initial: makePayslip(),
      initialLines: [
        makePayslipLine({ id: 'pl1', label: 'Ordinary Hours', amount_cents: 4_000_00 }),
        makePayslipLine({ id: 'pl2', label: 'Annual Leave', amount_cents: 1_000_00 }),
      ],
    })

    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Ordinary Hours')
    expect(screen.getByLabelText('Earnings line 2 name')).toHaveValue('Annual Leave')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([
      earningLine('i1', 'Ordinary Hours', 4_000_00),
      earningLine('i1', 'Annual Leave', 1_000_00),
    ])
  })
})

describe('PayslipForm tax lines', () => {
  /** Fills tax line `position` with a name, an amount, and the component it pays. */
  async function fillTaxLine(
    user: ReturnType<typeof userEvent.setup>,
    position: number,
    label: string,
    amount: string,
    component?: string,
  ) {
    await user.type(screen.getByLabelText(`Tax line ${position} name`), label)
    await user.type(screen.getByLabelText(`Tax line ${position} amount`), amount)
    if (component !== undefined) {
      await user.click(screen.getByRole('combobox', { name: `Tax line ${position} pays` }))
      await user.click(await screen.findByRole('option', { name: component }))
    }
  }

  it('explains that itemising tax splits the variance, not the year’s withholding', () => {
    renderForm()
    expect(screen.getByText('Tax lines')).toBeInTheDocument()
    expect(screen.getByText(/STSL against the compulsory HELP repayment/i)).toHaveTextContent(
      /stays the printed total/i,
    )
  })

  it('submits the slip’s PAYG and STSL components as tax lines', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add tax line/i }))
    await user.click(screen.getByRole('button', { name: /add tax line/i }))
    await fillTaxLine(user, 1, 'PAYG', '1416', 'PAYG income tax')
    await fillTaxLine(user, 2, 'STSL Component', '434', 'STSL (study loan)')
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // A tax line names no inflow, whatever the earnings lines beside it draw on.
    expect(submitted(onSubmit).lines).toEqual([
      {
        kind: 'tax',
        source_inflow_id: null,
        tax_component: 'payg',
        label: 'PAYG',
        amount_cents: 1_416_00,
      },
      {
        kind: 'tax',
        source_inflow_id: null,
        tax_component: 'stsl',
        label: 'STSL Component',
        amount_cents: 434_00,
      },
    ])
  })

  it('blocks the save until a tax line names what it pays', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add tax line/i }))
    await fillTaxLine(user, 1, 'PAYG', '1850')

    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeDisabled()
    // The picker holding the save is the one that asks for the answer.
    expect(screen.getByText('Say which part this pays.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Tax line 1 pays' })).toBeInvalid()

    await user.click(screen.getByRole('combobox', { name: 'Tax line 1 pays' }))
    await user.click(await screen.findByRole('option', { name: 'PAYG income tax' }))
    expect(screen.queryByText('Say which part this pays.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeEnabled()
  })

  it('reports the withheld tax the lines account for, and the gap either way', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add tax line/i }))
    await fillTaxLine(user, 1, 'PAYG', '1416', 'PAYG income tax')
    expect(screen.getByText(/of the tax withheld is not itemised/i)).toHaveTextContent('$434.00')

    await user.clear(screen.getByLabelText('Tax line 1 amount'))
    await user.type(screen.getByLabelText('Tax line 1 amount'), '1900')
    expect(screen.getByText(/more than the tax withheld is itemised/i)).toHaveTextContent('$50.00')

    await user.clear(screen.getByLabelText('Tax line 1 amount'))
    await user.type(screen.getByLabelText('Tax line 1 amount'), '1850')
    expect(screen.getByText(/every dollar is itemised/i)).toBeInTheDocument()
  })

  it('opens a slip with its saved tax lines and removes one', async () => {
    const user = userEvent.setup({ delay: null })
    renderForm({
      initial: makePayslip(),
      initialLines: [
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

    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Ordinary Hours')
    expect(screen.getByLabelText('Tax line 1 name')).toHaveValue('PAYG')
    expect(screen.getByLabelText('Tax line 2 name')).toHaveValue('STSL Component')

    await user.click(screen.getByRole('button', { name: 'Remove tax line 1' }))

    expect(screen.getByLabelText('Tax line 1 name')).toHaveValue('STSL Component')
    expect(screen.queryByLabelText('Tax line 2 name')).not.toBeInTheDocument()
    // Removing a tax line leaves the earnings lines untouched.
    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Ordinary Hours')
  })
})
