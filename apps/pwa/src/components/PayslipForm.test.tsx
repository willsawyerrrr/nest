import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PayslipSubmission } from '../hooks/usePayslips'
import { makeInflow, makePayslip } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { PayslipForm } from './PayslipForm'

const member = { id: 'm1', name: 'Will' }

const inflows = [
  makeInflow({ id: 'i1', name: 'Day job' }),
  makeInflow({ id: 'i2', name: 'Side job', member_id: 'm2' }),
  makeInflow({ id: 'i3', name: 'Gift money', taxable: false }),
]

/** The single submission the form passed to its `onSubmit`. */
function submitted(onSubmit: ReturnType<typeof vi.fn>): PayslipSubmission {
  return onSubmit.mock.calls[0]![0] as PayslipSubmission
}

describe('PayslipForm', () => {
  it('submits the quartet in cents with the financial year derived from the pay period', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        initial={makePayslip({
          period_start: '2026-06-17',
          period_end: '2026-06-30',
          source_inflow_id: null,
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit)).toEqual({
      input: {
        member_id: 'm1',
        // Derived from the period's last day, not typed: 30 June falls in FY2026.
        financial_year: 2026,
        period_start: '2026-06-17',
        period_end: '2026-06-30',
        paid_on: '2026-07-15',
        gross_cents: 5_000_00,
        tax_withheld_cents: 1_000_00,
        super_cents: 600_00,
        net_cents: 4_000_00,
        salary_sacrifice_cents: null,
        ytd_gross_cents: null,
        ytd_tax_withheld_cents: null,
        ytd_super_cents: null,
        source_inflow_id: null,
        note: null,
      },
      file: null,
    })
  })

  it('shows the derived financial year and offers no field to type it in', () => {
    const { unmount } = render(
      <PayslipForm
        member={member}
        inflows={inflows}
        initial={makePayslip({ period_start: '2026-06-17', period_end: '2026-06-30' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/filed under fy2026/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/financial year/i)).not.toBeInTheDocument()
    unmount()

    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        initial={makePayslip({ period_start: '2026-07-01', period_end: '2026-07-14' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/filed under fy2027/i)).toBeInTheDocument()
  })

  it('offers only the member’s own taxable inflows to reconcile against', async () => {
    const user = userEvent.setup()
    render(<PayslipForm member={member} inflows={inflows} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('combobox', { name: /reconciles against/i }))

    expect(await screen.findByRole('option', { name: 'Day job' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Side job' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Gift money' })).not.toBeInTheDocument()
  })

  it('notes when the member has no taxable inflow to reconcile against', () => {
    render(<PayslipForm member={member} inflows={[]} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('No taxable inflows')).toBeInTheDocument()
  })

  it('records the chosen inflow and the typed note', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        initial={makePayslip({ source_inflow_id: null, note: '  ' })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /reconciles against/i }))
    await user.click(await screen.findByRole('option', { name: 'Day job' }))
    await user.type(screen.getByLabelText('Note'), 'Includes back-pay')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.source_inflow_id).toBe('i1')
    expect(submitted(onSubmit).input.note).toBe('Includes back-pay')
  })

  it('trims a note that is only whitespace away to nothing', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        initial={makePayslip({ note: '  ' })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.note).toBeNull()
  })

  it('blocks a submit while the pay period is incomplete', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm member={member} inflows={inflows} initial={makePayslip()} onSubmit={onSubmit} />,
    )

    await user.clear(screen.getByLabelText('Period end'))
    await user.tab()

    expect(screen.queryByText(/filed under fy/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('rejects a pay period ending before it starts, without submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
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

  it('attaches a payslip document alongside the typed figures', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const file = new File(['x'], 'slip.pdf', { type: 'application/pdf' })
    render(
      <PayslipForm member={member} inflows={inflows} initial={makePayslip()} onSubmit={onSubmit} />,
    )

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file)
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).file).toBe(file)
  })

  it('says a new document replaces the one already attached', () => {
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        initial={makePayslip({ file_path: 'h1/ps1/slip.pdf' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/replaces the document already attached/i)).toBeInTheDocument()
  })

  it('holds the salary sacrifice and year-to-date figures a slip reports', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
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
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    render(
      <PayslipForm member={member} inflows={inflows} onSubmit={onSubmit} onCancel={onCancel} />,
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
      source_inflow_id: null,
    })
    // Thirteen days back from the end day makes an inclusive fortnight.
    const days =
      (Date.parse(`${input.period_end}T00:00:00Z`) -
        Date.parse(`${input.period_start}T00:00:00Z`)) /
      86_400_000
    expect(days).toBe(13)
    expect(
      screen.getByText(`Filed under FY${input.financial_year}, derived from the pay period.`),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
