import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayslipAttachments, PayslipSubmission } from '../hooks/usePayslips'
import {
  EXTRACTION_KEY_REJECTED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  type ExtractionOutcome,
  type PayslipExtraction,
} from '../lib/payslipExtraction'
import { makeInflow, makePayslip, makePayslipLine, makePayslipTaxLine } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { PayslipForm } from './PayslipForm'

const member = { id: 'm1', name: 'Will' }

const inflows = [
  makeInflow({ id: 'i1', name: 'Day job' }),
  makeInflow({ id: 'i2', name: 'Side job', member_id: 'm2' }),
  makeInflow({ id: 'i3', name: 'Gift money', taxable: false }),
  // Taxed in full, but no employer super accrues on it.
  makeInflow({ id: 'i4', name: 'On-call (T1)', type: 'other', attracts_super: false }),
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

/**
 * The form as its list renders it: the save is awaited and the form then closed,
 * which is what makes the attachment permanent. `keep()` runs after that close is
 * asked for, so the ordering — a close that is only scheduled, not yet flushed —
 * is what stops the unmount cleanup deleting the document the saved row points at.
 */
function ClosingPayslipForm({
  onSaved,
}: {
  onSaved: (submission: PayslipSubmission) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  if (!open) {
    return <p>Saved</p>
  }
  return (
    <PayslipForm
      member={member}
      inflows={inflows}
      attachments={attachments}
      onSubmit={async (submission) => {
        await onSaved(submission)
        setOpen(false)
      }}
    />
  )
}

/** Attaches a slip and waits for the store-and-read to settle. */
async function attach(user: ReturnType<typeof userEvent.setup>, name = 'slip.pdf') {
  await user.upload(filePicker(), new File(['x'], name, { type: 'application/pdf' }))
  await waitFor(() => expect(screen.queryByText(/the slip…$/)).not.toBeInTheDocument())
}

describe('PayslipForm', () => {
  it('submits the quartet in cents with the financial year derived from the payment date', async () => {
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

    await user.type(screen.getByLabelText('Note'), 'Includes back-pay')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
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
    expect(
      screen.getByText(/Kept what you already had; the slip reads Gross “4,120.50”\./),
    ).toBeInTheDocument()
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

  it('reads an account out of credit as reading being off, not as a broken read', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    read.mockResolvedValue({
      status: 'out-of-credit',
      message: EXTRACTION_OUT_OF_CREDIT_MESSAGE,
    } satisfies ExtractionOutcome)
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    // The same plain note an unset key gets, not the warning alert a failure the
    // member could act on is shown in.
    const note = screen.getByText(EXTRACTION_OUT_OF_CREDIT_MESSAGE)
    expect(note.closest('[role="alert"]')).toBeNull()
    // And never the unset-key note: topping up an account is a different fix.
    expect(screen.queryByText(EXTRACTION_UNCONFIGURED_MESSAGE)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Gross'), '1000')
    await user.type(screen.getByLabelText('Tax withheld'), '200')
    await user.type(screen.getByLabelText('Super'), '120')
    await user.type(screen.getByLabelText('Net'), '800')
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    // The save is untouched: the figures are typed by hand exactly as before, and
    // the document stays attached.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.gross_cents).toBe(1_000_00)
    expect(submitted(onSubmit).attachment).not.toBeNull()
  })

  it('reads a refused API key as reading being off, not as a broken read', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    read.mockResolvedValue({
      status: 'key-rejected',
      message: EXTRACTION_KEY_REJECTED_MESSAGE,
    } satisfies ExtractionOutcome)
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    // The same plain note the other switched-off states get, not the warning alert
    // a failure the member could act on is shown in.
    const note = screen.getByText(EXTRACTION_KEY_REJECTED_MESSAGE)
    expect(note.closest('[role="alert"]')).toBeNull()
    // And never either other note: rotating a key is neither setting one for the
    // first time nor topping an account up.
    expect(screen.queryByText(EXTRACTION_UNCONFIGURED_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByText(EXTRACTION_OUT_OF_CREDIT_MESSAGE)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Gross'), '1000')
    await user.type(screen.getByLabelText('Tax withheld'), '200')
    await user.type(screen.getByLabelText('Super'), '120')
    await user.type(screen.getByLabelText('Net'), '800')
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    // The save is untouched: the figures are typed by hand exactly as before, and
    // the document stays attached.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
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

    // A failure the member can act on is a warning alert, unlike the plain note
    // the switched-off states get.
    expect(
      screen.getByText(/24\.0 MB; the limit is 20\.0 MB/).closest('[role="alert"]'),
    ).not.toBeNull()
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

  it('keeps the stored document when the save closes the form itself', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<ClosingPayslipForm onSaved={onSaved} />)

    await attach(user)
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it('keeps a figure typed while the slip was still being read', async () => {
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
    await user.type(screen.getByLabelText('Net'), '3072')

    // The slip does not print a net, so the read has nothing to say about it.
    finishRead({
      status: 'read',
      extraction: extraction({ fields: { ...extraction().fields, net_cents: null } }),
    })
    await waitFor(() => expect(screen.queryByText('Reading the slip…')).not.toBeInTheDocument())

    expect(screen.getByLabelText('Net')).toHaveValue('$3,072.00')
    expect(screen.getByLabelText('Gross')).toHaveValue('$4,120.50')
  })

  it('blocks a save while the document is still being stored', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    let finishUpload!: (stored: { payslipId: string; path: string }) => void
    upload.mockImplementation(
      async (payslipId: string) =>
        await new Promise<{ payslipId: string; path: string }>((resolve) => {
          finishUpload = () => resolve({ payslipId, path: `h1/${payslipId}/uuid-slip.pdf` })
        }),
    )
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Gross'), '1000')
    await user.type(screen.getByLabelText('Tax withheld'), '200')
    await user.type(screen.getByLabelText('Super'), '120')
    await user.type(screen.getByLabelText('Net'), '800')
    await user.upload(filePicker(), new File(['x'], 'slip.pdf', { type: 'application/pdf' }))

    // Submitting here would save no attachment, orphaning the object being
    // stored under the id the row would then never be written under.
    const submit = await screen.findByRole('button', { name: /add payslip/i })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()

    finishUpload({ payslipId: 'ps1', path: 'h1/ps1/uuid-slip.pdf' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    await user.click(submit)

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).attachment).not.toBeNull()
  })

  it('leaves the figures a saved payslip already holds alone', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({ salary_sacrifice_cents: null })}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    // Every figure on the row was confirmed when it was saved, so a replacement
    // document is read without rewriting any of them.
    expect(screen.getByLabelText('Gross')).toHaveValue('$5,000.00')
    expect(screen.getByLabelText('Net')).toHaveValue('$4,000.00')
    expect(screen.getByLabelText('Period end')).toHaveValue('14 Jul 2026')
    // The text read is still shown for a field it left alone, so a figure the
    // slip disagrees with can be corrected by hand.
    expect(
      screen.getByText(/Kept what you already had; the slip reads .*Gross “4,120.50”/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.gross_cents).toBe(5_000_00)
  })

  it('files a replacement document under the payslip being edited', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <PayslipForm
        member={member}
        inflows={inflows}
        attachments={attachments}
        initial={makePayslip({ id: 'ps1', file_path: 'h1/ps1/old-slip.pdf' })}
        onSubmit={onSubmit}
      />,
    )

    await attach(user, 'new-slip.pdf')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(upload).toHaveBeenCalledWith('ps1', expect.any(File))
    expect(submitted(onSubmit).attachment).toEqual({
      payslipId: 'ps1',
      path: 'h1/ps1/uuid-new-slip.pdf',
    })
    // The superseded object is the caller's to drop, once the row points past it.
    expect(discard).not.toHaveBeenCalled()
  })
})

/** The submitted shape of one earnings line: no tax component, as the schema requires. */
function earningLine(sourceInflowId: string | null, label: string, amountCents: number) {
  return {
    kind: 'earning',
    source_inflow_id: sourceInflowId,
    tax_component: null,
    label,
    amount_cents: amountCents,
  }
}

/** Renders an add form for the member, returning its `onSubmit` spy. */
function renderForm(props: Partial<Parameters<typeof PayslipForm>[0]> = {}) {
  const onSubmit = vi.fn()
  render(
    <PayslipForm
      member={member}
      inflows={inflows}
      attachments={attachments}
      onSubmit={onSubmit}
      {...props}
    />,
  )
  return onSubmit
}

/** Types the quartet a save needs, at the real Heidi slip's figures. */
async function fillQuartet(user: ReturnType<typeof userEvent.setup>, gross = '5495.50') {
  await user.type(screen.getByLabelText('Gross'), gross)
  await user.type(screen.getByLabelText('Tax withheld'), '1850')
  await user.type(screen.getByLabelText('Super'), '600')
  await user.type(screen.getByLabelText('Net'), '3645.50')
}

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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    renderForm({ inflows: [] })

    await user.click(screen.getByRole('button', { name: /add earnings line/i }))

    expect(screen.getByRole('combobox', { name: 'Earnings line 1 draws on' })).toHaveAttribute(
      'placeholder',
      'No taxable inflows',
    )
  })

  it('reports the gross the lines account for, and the gap when they do not', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '5000', 'Day job')

    expect(screen.queryByText(/more of the gross is unitemised/i)).not.toBeInTheDocument()
  })

  it('leaves the warning off when no line names a projection to measure against', async () => {
    const user = userEvent.setup()
    renderForm()

    // Nothing maps to a projection, so the expected gross is null rather than
    // understated: there is no phantom variance to warn about.
    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'On-call (T1)', '495.50')

    expect(screen.queryByText(/more of the gross is unitemised/i)).not.toBeInTheDocument()
  })

  it('says every dollar is itemised once the lines sum to the gross', async () => {
    const user = userEvent.setup()
    renderForm()

    await fillQuartet(user, '5000')
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await fillLine(user, 1, 'Ordinary Hours', '5000')

    expect(screen.getByText(/every dollar is itemised/i)).toBeInTheDocument()
  })

  it('removes a line, leaving the rows beside it as they were', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.type(screen.getByLabelText('Earnings line 1 name'), 'Ordinary Hours')

    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeDisabled()

    await user.type(screen.getByLabelText('Earnings line 1 amount'), '5495.50')
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeEnabled()
  })

  it('drops a row left entirely blank rather than blocking the save on it', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([])
  })

  it('opens an itemised slip with its saved lines, and saves them back', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    renderForm()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add tax line/i }))
    await fillTaxLine(user, 1, 'PAYG', '1850')

    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'Tax line 1 pays' }))
    await user.click(await screen.findByRole('option', { name: 'PAYG income tax' }))
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeEnabled()
  })

  it('reports the withheld tax the lines account for, and the gap either way', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
