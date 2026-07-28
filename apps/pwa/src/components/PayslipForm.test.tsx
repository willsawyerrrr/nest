import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayslipAttachments, PayslipSubmission } from '../hooks/usePayslips'
import type { ExtractionOutcome, PayslipExtraction } from '../lib/payslipExtraction'
import { makeInflow, makePayslip } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { PayslipForm } from './PayslipForm'

const member = { id: 'm1', name: 'Will' }

const inflows = [
  makeInflow({ id: 'i1', name: 'Day job' }),
  makeInflow({ id: 'i2', name: 'Side job', member_id: 'm2' }),
  makeInflow({ id: 'i3', name: 'Gift money', taxable: false }),
]

/** What a slip's figures come back as when the model reads every one of them. */
function extraction(overrides: Partial<PayslipExtraction> = {}): PayslipExtraction {
  return {
    model: 'claude-haiku-4-5-20251001',
    fields: {
      period_start: '2026-07-06',
      period_end: '2026-07-19',
      paid_on: '2026-07-22',
      gross_cents: 4_120_50,
      tax_withheld_cents: 1_048_00,
      super_cents: 473_86,
      net_cents: 3_072_50,
      salary_sacrifice_cents: null,
    },
    text: {
      period_start: '06/07/2026',
      gross: '4,120.50',
      tax_withheld: '1,048.00',
      super: '473.86',
      net: '3,072.50',
      ytd_super: '4,12O.50',
    },
    missing: ['salary_sacrifice_cents'],
    unreadable: [],
    ...overrides,
  }
}

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()
const attachments: PayslipAttachments = { upload, discard, read }

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(async (payslipId: string, file: File) => ({
    payslipId,
    path: `h1/${payslipId}/uuid-${file.name}`,
  }))
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({ status: 'read', extraction: extraction() } satisfies ExtractionOutcome)
})

/** The single submission the form passed to its `onSubmit`. */
function submitted(onSubmit: ReturnType<typeof vi.fn>): PayslipSubmission {
  return onSubmit.mock.calls[0]![0] as PayslipSubmission
}

/** The form's file picker, which has no accessible label of its own. */
function filePicker() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

/** Attaches a slip and waits for the store-and-read to settle. */
async function attach(user: ReturnType<typeof userEvent.setup>, name = 'slip.pdf') {
  await user.upload(filePicker(), new File(['x'], name, { type: 'application/pdf' }))
  await waitFor(() => expect(screen.queryByText(/the slip…$/)).not.toBeInTheDocument())
}

describe('PayslipForm', () => {
  it('submits the quartet in cents with the financial year derived from the pay period', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
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
      attachment: null,
    })
  })

  it('shows the derived financial year and offers no field to type it in', () => {
    const { unmount } = render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
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
        attachments={attachments}
        initial={makePayslip({ period_start: '2026-07-01', period_end: '2026-07-14' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/filed under fy2027/i)).toBeInTheDocument()
  })

  it('offers only the member’s own taxable inflows to reconcile against', async () => {
    const user = userEvent.setup()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /reconciles against/i }))

    expect(await screen.findByRole('option', { name: 'Day job' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Side job' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Gift money' })).not.toBeInTheDocument()
  })

  it('notes when the member has no taxable inflow to reconcile against', () => {
    render(
      <PayslipForm member={member} inflows={[]} attachments={attachments} onSubmit={vi.fn()} />,
    )
    expect(screen.getByPlaceholderText('No taxable inflows')).toBeInTheDocument()
  })

  it('records the chosen inflow and the typed note', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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

describe('PayslipForm extraction', () => {
  it('pre-fills the figures read off an attached slip and saves them in cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    expect(screen.getByLabelText('Gross')).toHaveValue('$4,120.50')
    expect(screen.getByLabelText('Super')).toHaveValue('$473.86')
    expect(screen.getByLabelText('Period end')).toHaveValue('19 Jul 2026')

    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submission = submitted(onSubmit)
    expect(submission.input).toMatchObject({
      period_start: '2026-07-06',
      period_end: '2026-07-19',
      paid_on: '2026-07-22',
      gross_cents: 4_120_50,
      tax_withheld_cents: 1_048_00,
      super_cents: 473_86,
      net_cents: 3_072_50,
      salary_sacrifice_cents: null,
    })
    // The document was stored before it was read, so the row is written under
    // the id it is already filed against.
    expect(submission.attachment).toEqual({
      payslipId: expect.any(String),
      path: `h1/${submission.attachment!.payslipId}/uuid-slip.pdf`,
    })
    expect(read).toHaveBeenCalledWith(submission.attachment!.path)
  })

  it('shows the text it read, what the slip omits, and what it could not convert', async () => {
    const user = userEvent.setup()
    read.mockResolvedValue({
      status: 'read',
      extraction: extraction({
        fields: { gross_cents: 4_120_50 },
        unreadable: ['ytd_super_cents'],
      }),
    })
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(screen.getByText(/Filled in: Gross “4,120.50”\./)).toBeInTheDocument()
    expect(screen.getByText(/Not shown on the slip: Salary sacrifice\./)).toBeInTheDocument()
    expect(screen.getByText(/left blank: YTD super “4,12O.50”\./)).toBeInTheDocument()
  })

  it('says plainly when a slip yielded nothing to fill in', async () => {
    const user = userEvent.setup()
    read.mockResolvedValue({
      status: 'read',
      extraction: extraction({
        fields: {},
        missing: ['gross_cents', 'net_cents'],
        unreadable: ['period_start', 'period_end'],
      }),
    })
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(screen.getByText(/Nothing on the slip could be filled in for you\./)).toBeInTheDocument()
    expect(screen.getByText(/Not shown on the slip: Gross, Net\./)).toBeInTheDocument()
    // The one with no text at all is named on its own; the misread shows what was seen.
    expect(
      screen.getByText(/left blank: Period start “06\/07\/2026”, Period end\./),
    ).toBeInTheDocument()
  })

  it('keeps a figure the member typed rather than replacing it with a read one', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Gross'), '5000')
    await attach(user)

    expect(screen.getByLabelText('Gross')).toHaveValue('$5,000.00')
    expect(screen.getByText(/Kept what you had already typed for Gross\./)).toBeInTheDocument()
    // The figures the member left alone are still filled from the slip.
    expect(screen.getByLabelText('Net')).toHaveValue('$3,072.50')

    await user.click(screen.getByRole('button', { name: /add payslip/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.gross_cents).toBe(5_000_00)
  })

  it('leaves every figure a read filled in editable', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    await user.type(screen.getByLabelText('Salary sacrifice'), '50')
    await user.type(screen.getByLabelText('YTD gross'), '12000')
    await user.type(screen.getByLabelText('YTD tax withheld'), '3000')
    await user.type(screen.getByLabelText('YTD super'), '1400')
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input).toMatchObject({
      salary_sacrifice_cents: 50_00,
      ytd_gross_cents: 12_000_00,
      ytd_tax_withheld_cents: 3_000_00,
      ytd_super_cents: 1_400_00,
    })
  })

  it('says so while the slip is being stored and read', async () => {
    const user = userEvent.setup()
    let finishRead!: (outcome: ExtractionOutcome) => void
    read.mockReturnValue(
      new Promise<ExtractionOutcome>((resolve) => {
        finishRead = resolve
      }),
    )
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await user.upload(filePicker(), new File(['x'], 'slip.pdf', { type: 'application/pdf' }))

    expect(await screen.findByText('Reading the slip…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Payslip document' })).toBeDisabled()

    finishRead({ status: 'read', extraction: extraction() })
    await waitFor(() => expect(screen.queryByText('Reading the slip…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Payslip document' })).not.toBeDisabled()
  })

  it('falls back to manual entry with an honest note when extraction is not configured', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    read.mockResolvedValue({
      status: 'not-configured',
      message: 'Payslip extraction is not configured. Enter the figures by hand.',
    })
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    expect(screen.getByText(/is not configured\. Enter the figures by hand\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Gross')).toHaveValue('')

    await user.type(screen.getByLabelText('Gross'), '1000')
    await user.type(screen.getByLabelText('Tax withheld'), '200')
    await user.type(screen.getByLabelText('Super'), '120')
    await user.type(screen.getByLabelText('Net'), '800')
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // The document is still attached and saved: the read failing does not lose it.
    expect(submitted(onSubmit).input.gross_cents).toBe(1_000_00)
    expect(submitted(onSubmit).attachment).not.toBeNull()
  })

  it('passes on the model’s reason for a file that is not a payslip', async () => {
    const user = userEvent.setup()
    read.mockResolvedValue({
      status: 'not-payslip',
      message: 'That file does not look like a payslip.',
      reason: 'It is a bank statement.',
    })
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(
      screen.getByText(
        /does not look like a payslip\. It is a bank statement\. Enter the figures by hand\./,
      ),
    ).toBeInTheDocument()
  })

  it('shows a refusal that came with no reason of its own', async () => {
    const user = userEvent.setup()
    read.mockResolvedValue({
      status: 'not-payslip',
      message: 'That file does not look like a payslip.',
      reason: null,
    })
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(
      screen.getByText(/does not look like a payslip\. Enter the figures by hand\./),
    ).toBeInTheDocument()
  })

  it('shows the function’s own message for a size, type, or model failure', async () => {
    const user = userEvent.setup()
    read.mockResolvedValue({
      status: 'failed',
      message: 'That file is too large to read (24.0 MB; the limit is 20.0 MB).',
    })
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(screen.getByText(/24\.0 MB; the limit is 20\.0 MB/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add payslip/i })).toBeDisabled()
  })

  it('reports a document that could not be stored, and reads nothing', async () => {
    const user = userEvent.setup()
    upload.mockRejectedValue(new Error('nope'))
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(screen.getByText(/Could not upload this document/)).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
  })

  it('deletes an attached document the member clears or walks away from', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)
    const stored = (await upload.mock.results[0]!.value) as { path: string }
    await user.click(screen.getByRole('button', { name: /remove the attached document/i }))
    await waitFor(() => expect(discard).toHaveBeenCalledWith(stored.path))

    await attach(user, 'second.pdf')
    unmount()
    await waitFor(() => expect(discard).toHaveBeenCalledTimes(2))
  })

  it('keeps the stored document once the save that references it succeeds', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const { unmount } = render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)
    await user.click(screen.getByRole('button', { name: /add payslip/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    unmount()

    expect(discard).not.toHaveBeenCalled()
  })
})
