import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXTRACTION_KEY_REJECTED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  type ExtractionOutcome,
  type PayslipExtraction,
} from '../lib/payslipExtraction'
import { makeInflow, makePayslip, makePayslipLine, makePayslipTaxLine } from '../test/fixtures'
import {
  attach,
  attachments,
  ClosingPayslipForm,
  discard,
  earningLine,
  extraction,
  filePicker,
  fillQuartet,
  inflows,
  member,
  read,
  renderForm,
  resetPayslipAttachmentMocks,
  submitted,
  taxLine,
  upload,
} from '../test/payslipForm'
import { render, screen, waitFor } from '../test/render'
import { PayslipForm } from './PayslipForm'

beforeEach(resetPayslipAttachmentMocks)

describe('PayslipForm extraction', () => {
  it('pre-fills the figures read off an attached slip and saves them in cents', async () => {
    const user = userEvent.setup({ delay: null })
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

  it('says the figures were extracted and asks for a check, without restating them', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'read',
      // Only the gross came back: the slip shows no salary sacrifice, and a misread
      // YTD super could not be converted safely.
      extraction: extraction({ fields: { gross_cents: 4_120_50 } }),
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

    const note = screen.getByText(/extracted from the document by AI/i)
    expect(note).toHaveTextContent(/check them against it before saving/i)
    // Each figure is on screen in the field it filled, so the note names none of
    // them and repeats none of the text the model read: what the member checks the
    // document against is the form itself.
    expect(note).not.toHaveTextContent(/Gross/i)
    expect(note).not.toHaveTextContent(/4,120\.50/)
    expect(screen.getByLabelText('Gross')).toHaveValue('$4,120.50')
    // A figure the slip does not show, and one that could not be read safely, are
    // both left blank rather than guessed at.
    expect(screen.getByLabelText('Salary sacrifice')).toHaveValue('')
    expect(screen.getByLabelText('YTD super')).toHaveValue('')
  })

  it('says plainly when a slip yielded nothing to fill in', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({ status: 'read', extraction: extraction({ fields: {} }) })
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
    // Nothing was filled, so nothing is claimed to have been.
    expect(screen.queryByText(/extracted from the document by AI/i)).not.toBeInTheDocument()
  })

  it('keeps a figure the member typed rather than replacing it with a read one', async () => {
    const user = userEvent.setup({ delay: null })
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
    // The figures the member left alone are still filled from the slip.
    expect(screen.getByLabelText('Net')).toHaveValue('$3,072.50')

    await user.click(screen.getByRole('button', { name: /add payslip/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.gross_cents).toBe(5_000_00)
  })

  it('leaves every figure a read filled in editable', async () => {
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<ClosingPayslipForm onSaved={onSaved} />)

    await attach(user)
    await user.click(screen.getByRole('button', { name: /add payslip/i }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it('keeps a figure typed while the slip was still being read', async () => {
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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
    // So the read filled nothing, and the note says exactly that rather than
    // claiming figures it did not write.
    expect(screen.getByText(/Nothing on the slip could be filled in for you\./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.gross_cents).toBe(5_000_00)
  })

  it('files a replacement document under the payslip being edited', async () => {
    const user = userEvent.setup({ delay: null })
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

describe('PayslipForm extracted lines', () => {
  /** The real slip's itemisation, as a read reports it. */
  function itemised(overrides: Partial<PayslipExtraction['lines']> = {}): PayslipExtraction {
    return extraction({
      lines: {
        earnings: [
          { label: 'Ordinary Hours', amount_cents: 4_000_00 },
          { label: 'Annual Leave', amount_cents: 1_000_00 },
          { label: 'On-call (T1)', amount_cents: 495_50 },
        ],
        tax: [
          { label: 'PAYG', amount_cents: 1_416_00, component: 'payg' },
          { label: 'STSL Component', amount_cents: 434_00, component: 'stsl' },
        ],
        ...overrides,
      },
    })
  }

  /** Reads a slip whose itemisation is `overrides` over the real slip's. */
  function reads(overrides: Partial<PayslipExtraction['lines']> = {}) {
    read.mockResolvedValue({
      status: 'read',
      extraction: itemised(overrides),
    } satisfies ExtractionOutcome)
  }

  it('itemises the slip into both sections and saves the lines it read', async () => {
    const user = userEvent.setup({ delay: null })
    reads()
    const onSubmit = renderForm()

    await attach(user)

    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Ordinary Hours')
    expect(screen.getByLabelText('Earnings line 1 amount')).toHaveValue('$4,000.00')
    expect(screen.getByLabelText('Earnings line 2 name')).toHaveValue('Annual Leave')
    expect(screen.getByLabelText('Earnings line 3 amount')).toHaveValue('$495.50')
    expect(screen.getByLabelText('Tax line 1 name')).toHaveValue('PAYG')
    expect(screen.getByLabelText('Tax line 2 amount')).toHaveValue('$434.00')
    // Each component comes from the slip's own words, which name it plainly.
    expect(screen.getByRole('combobox', { name: 'Tax line 1 pays' })).toHaveValue('PAYG income tax')
    expect(screen.getByRole('combobox', { name: 'Tax line 2 pays' })).toHaveValue(
      'STSL (study loan)',
    )

    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([
      earningLine(null, 'Ordinary Hours', 4_000_00),
      earningLine(null, 'Annual Leave', 1_000_00),
      // The one printed label naming exactly one of the member's inflows.
      earningLine('i4', 'On-call (T1)', 495_50),
      taxLine('payg', 'PAYG', 1_416_00),
      taxLine('stsl', 'STSL Component', 434_00),
    ])
  })

  it('shows a matched inflow on the line’s own picker, never in the note', async () => {
    const user = userEvent.setup({ delay: null })
    reads()
    renderForm()

    await attach(user)

    // Attribution is a guess off the printed label, so it is shown where it can be
    // changed rather than named in a paragraph beside the rows.
    expect(screen.getByRole('combobox', { name: 'Earnings line 3 draws on' })).toHaveValue(
      'On-call (T1)',
    )
    expect(screen.getByRole('combobox', { name: 'Earnings line 1 draws on' })).toHaveValue('')
    const note = screen.getByText(/extracted from the document by AI/i)
    expect(note).not.toHaveTextContent(/On-call/)
    expect(note).not.toHaveTextContent(/Ordinary Hours/)
  })

  it('pre-selects the inflow a label names exactly, and nothing on a near miss', async () => {
    const user = userEvent.setup({ delay: null })
    reads({
      earnings: [
        // Case is normalised away; the whole label must match the whole name, so a
        // prefix and a suffix both come back unset.
        { label: 'ON-CALL (t1)', amount_cents: 495_50 },
        { label: 'On-call', amount_cents: 100_00 },
        { label: 'On-call (T1) allowance', amount_cents: 100_00 },
      ],
    })
    renderForm()

    await attach(user)

    expect(screen.getByRole('combobox', { name: 'Earnings line 1 draws on' })).toHaveValue(
      'On-call (T1)',
    )
    expect(screen.getByRole('combobox', { name: 'Earnings line 2 draws on' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Earnings line 3 draws on' })).toHaveValue('')
  })

  it('leaves a label two inflows answer to for the member to pick', async () => {
    const user = userEvent.setup({ delay: null })
    reads({ earnings: [{ label: 'On-call (T1)', amount_cents: 495_50 }] })
    renderForm({
      inflows: [...inflows, makeInflow({ id: 'i5', name: 'On-call (T1)', type: 'other' })],
    })

    await attach(user)

    // Attributing it to either would move the measured variance of both.
    expect(screen.getByRole('combobox', { name: 'Earnings line 1 draws on' })).toHaveValue('')
  })

  it('keeps the lines the member has typed, and fills the section they left alone', async () => {
    const user = userEvent.setup({ delay: null })
    reads()
    const onSubmit = renderForm()

    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.type(screen.getByLabelText('Earnings line 1 name'), 'Overtime')
    await user.type(screen.getByLabelText('Earnings line 1 amount'), '5495.50')
    await attach(user)

    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Overtime')
    expect(screen.queryByLabelText('Earnings line 2 name')).not.toBeInTheDocument()
    // The tax section was never theirs, so its itemisation is still filled in.
    expect(screen.getByLabelText('Tax line 1 name')).toHaveValue('PAYG')

    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([
      earningLine(null, 'Overtime', 5_495_50),
      taxLine('payg', 'PAYG', 1_416_00),
      taxLine('stsl', 'STSL Component', 434_00),
    ])
  })

  it('leaves the lines a saved payslip already holds alone', async () => {
    const user = userEvent.setup({ delay: null })
    reads()
    const onSubmit = renderForm({
      initial: makePayslip(),
      initialLines: [
        makePayslipLine({ label: 'Base salary', amount_cents: 5_000_00 }),
        makePayslipTaxLine({ label: 'Tax', amount_cents: 1_000_00 }),
      ],
    })

    await attach(user)

    // Each was confirmed when the slip was saved, so a replacement document is read
    // without rewriting the itemisation on file.
    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Base salary')
    expect(screen.getByLabelText('Tax line 1 name')).toHaveValue('Tax')
    expect(screen.queryByLabelText('Earnings line 2 name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tax line 2 name')).not.toBeInTheDocument()
    // Every figure and both sections were already theirs, so the read filled
    // nothing and the note says so rather than claiming otherwise.
    expect(screen.getByText(/Nothing on the slip could be filled in for you\./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([
      earningLine('i1', 'Base salary', 5_000_00),
      taxLine('payg', 'Tax', 1_000_00),
    ])
  })

  it('asks on the row itself which part of the tax a line the slip does not place pays', async () => {
    const user = userEvent.setup({ delay: null })
    reads({
      tax: [
        { label: 'PAYG', amount_cents: 1_416_00, component: 'payg' },
        { label: 'Tax deducted', amount_cents: 434_00, component: null },
      ],
    })
    renderForm()

    await attach(user)

    expect(screen.getByLabelText('Tax line 2 name')).toHaveValue('Tax deducted')
    // Never quietly PAYG: the two pay different parts of the liability, so the save
    // waits on the member rather than filing a guess.
    expect(screen.getByRole('combobox', { name: 'Tax line 2 pays' })).toHaveValue('')
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeDisabled()
    // The row that needs the answer is the one that asks for it, so the blocked
    // save has a visible cause the member can act on where it is.
    expect(screen.getByText('Say which part this pays.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Tax line 2 pays' })).toBeInvalid()
    // And only that row: the line the slip did place is not flagged.
    expect(screen.getByRole('combobox', { name: 'Tax line 1 pays' })).toBeValid()

    await user.click(screen.getByRole('combobox', { name: 'Tax line 2 pays' }))
    await user.click(await screen.findByRole('option', { name: 'PAYG income tax' }))
    expect(screen.queryByText('Say which part this pays.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeEnabled()
  })

  it('does not itemise a line whose printed amount could not be read', async () => {
    const user = userEvent.setup({ delay: null })
    reads({
      earnings: [
        { label: 'Ordinary Hours', amount_cents: 4_000_00 },
        { label: 'Overtime', amount_cents: null },
        { label: 'Bonus', amount_cents: null },
      ],
    })
    renderForm()

    await attach(user)

    // A half-filled row would block the save, so a line whose amount could not be
    // read is left out entirely, as an unreadable total is left blank.
    expect(screen.getByLabelText('Earnings line 1 name')).toHaveValue('Ordinary Hours')
    expect(screen.queryByLabelText('Earnings line 2 name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add payslip$/i })).toBeEnabled()
    // What is left out shows where it counts: the gross the rows do not account for
    // is reported against the lines themselves.
    expect(screen.getByText(/of the gross is not itemised/i)).toHaveTextContent('$120.50')
  })

  it('itemises nothing when the read fails, and saves the lines typed by hand', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'failed',
      message: 'Could not read this payslip. Enter the figures by hand.',
    } satisfies ExtractionOutcome)
    const onSubmit = renderForm()

    await attach(user)

    expect(screen.queryByLabelText('Earnings line 1 name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tax line 1 name')).not.toBeInTheDocument()

    await fillQuartet(user)
    await user.click(screen.getByRole('button', { name: /add earnings line/i }))
    await user.type(screen.getByLabelText('Earnings line 1 name'), 'Ordinary Hours')
    await user.type(screen.getByLabelText('Earnings line 1 amount'), '5495.50')
    await user.click(screen.getByRole('button', { name: /^add payslip$/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).lines).toEqual([earningLine(null, 'Ordinary Hours', 5_495_50)])
    expect(submitted(onSubmit).attachment).not.toBeNull()
  })
})
