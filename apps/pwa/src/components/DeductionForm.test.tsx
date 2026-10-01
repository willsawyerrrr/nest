import { useState, type ComponentProps } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UPLOAD_FAILED_MESSAGE, type DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import {
  EXTRACTION_KEY_REJECTED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  type DeductionExtraction,
  type ExtractionOutcome,
} from '../lib/deductionExtraction'
import { FILE_TOO_LARGE_MESSAGE, MAX_UPLOAD_BYTES } from '../lib/uploadFile'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { DeductionForm } from './DeductionForm'

const member = { id: 'm1', name: 'Will' }

function makeDeduction(overrides: Partial<DeductionRow> = {}): DeductionRow {
  return {
    id: 'd1',
    household_id: 'h1',
    member_id: 'm1',
    description: 'Home office',
    amount_cents: 1_200_00,
    deduction_date: '2026-08-01',
    financial_year: 2027,
    basis: 'amount',
    distance_km: null,
    group_id: null,
    full_amount_cents: 1_200_00,
    work_use_percent: 100,
    category: 'work_expense',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeGroup(overrides: Partial<DeductionGroupRow> = {}): DeductionGroupRow {
  return {
    id: 'g1',
    household_id: 'h1',
    member_id: 'm1',
    kind: 'standard',
    name: 'Adobe Creative Cloud',
    financial_year: 2027,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** What a receipt's fields come back as when the model reads every one of them. */
function extraction(overrides: Partial<DeductionExtraction['fields']> = {}): DeductionExtraction {
  return {
    model: 'claude-haiku-4-5-20251001',
    fields: {
      description: 'Officeworks',
      deduction_date: '2026-08-05',
      amount_cents: 124_50,
      ...overrides,
    },
  }
}

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()
const attachments: DeductionAttachments = { upload, discard, read }

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(
    async (deductionId: string, file: File) => `h1/${deductionId}/uuid-${file.name}`,
  )
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({ status: 'read', extraction: extraction() } satisfies ExtractionOutcome)
})

/** The single submission the form passed to its `onSubmit`. */
function submitted(onSubmit: ReturnType<typeof vi.fn>): DeductionSubmission {
  return onSubmit.mock.calls[0]![0] as DeductionSubmission
}

/** The form's file picker, which has no accessible label of its own. */
function filePicker() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

/** Attaches a receipt and waits for the store-and-read to settle. */
async function attach(user: ReturnType<typeof userEvent.setup>, name = 'receipt.pdf') {
  await user.upload(filePicker(), new File(['x'], name, { type: 'application/pdf' }))
  await waitFor(() => expect(screen.queryByText(/the receipt…$/)).not.toBeInTheDocument())
}

describe('DeductionForm', () => {
  it('submits a deduction with the amount in cents, minting its own id', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '350')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submission = submitted(onSubmit)
    expect(submission.id).toEqual(expect.any(String))
    expect(submission.input).toMatchObject({
      member_id: 'm1',
      description: 'Tools',
      amount_cents: 350_00,
    })
    expect(submission.input.deduction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(submission.receiptPath).toBeNull()
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '10')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('ignores a submit while the form is incomplete', () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.submit(container.querySelector('form')!)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('prefills an existing deduction, offers no receipt picker without receipt handlers, and cancels', async () => {
    const user = userEvent.setup({ delay: null })
    const onCancel = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByDisplayValue('Home office')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('What kind of deduction?')).not.toBeInTheDocument()
    // No extraction mechanics on an edit, and no picker unless the caller
    // supplies receipt handlers.
    expect(filePicker()).toBeNull()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('offers replace and delete for an existing receipt when editing', async () => {
    const user = userEvent.setup({ delay: null })
    const onUploadReceipt = vi.fn().mockResolvedValue(undefined)
    const onRemoveReceipt = vi.fn()
    const receipt = {
      id: 'r1',
      deduction_id: 'd1',
      storage_path: 'h1/d1/a.pdf',
      file_name: 'a.pdf',
    } as never
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction()}
        receipt={receipt}
        onUploadReceipt={onUploadReceipt}
        onRemoveReceipt={onRemoveReceipt}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /more details/i }))
    const file = new File(['y'], 'newer.pdf', { type: 'application/pdf' })
    await user.upload(filePicker() as HTMLInputElement, file)
    expect(onUploadReceipt).toHaveBeenCalledWith(file)
    expect(screen.getByLabelText('Replace receipt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /delete receipt/i }))
    expect(onRemoveReceipt).toHaveBeenCalledWith(receipt)
  })

  it('says why a receipt over the size limit was not attached to an existing deduction', async () => {
    const user = userEvent.setup({ delay: null })
    const onUploadReceipt = vi.fn().mockResolvedValue(undefined)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction()}
        onUploadReceipt={onUploadReceipt}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /more details/i }))
    const big = new File(['y'], 'big.pdf')
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    await user.upload(filePicker() as HTMLInputElement, big)

    expect(await screen.findByText(FILE_TOO_LARGE_MESSAGE)).toBeInTheDocument()
    expect(onUploadReceipt).not.toHaveBeenCalled()
  })

  it('says so when a receipt could not be attached to an existing deduction', async () => {
    const user = userEvent.setup({ delay: null })
    const onUploadReceipt = vi.fn().mockRejectedValue(new Error('storage'))
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction()}
        onUploadReceipt={onUploadReceipt}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /more details/i }))
    await user.upload(filePicker() as HTMLInputElement, new File(['y'], 'notes.docx'))

    expect(await screen.findByText(UPLOAD_FAILED_MESSAGE)).toBeInTheDocument()

    await user.upload(filePicker() as HTMLInputElement, new File(['y'], 'other.docx'))
    await waitFor(() => expect(onUploadReceipt).toHaveBeenCalledTimes(2))
  })

  it('submits the resubmitted fields for an edit, with the deduction’s own id', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction()}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit)).toEqual({
      id: 'd1',
      input: {
        member_id: 'm1',
        description: 'Home office',
        amount_cents: 1_200_00,
        deduction_date: '2026-08-01',
        basis: 'amount',
        distance_km: null,
        group_id: null,
        category: 'work_expense',
        full_amount_cents: 1_200_00,
        work_use_percent: 100,
      },
      receiptPath: null,
    })
    expect(upload).not.toHaveBeenCalled()
  })

  it('computes the amount from distance at the FY2027 cents-per-km rate on the distance basis', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Client visits')
    await user.click(screen.getByText('Distance (km)'))
    await user.type(screen.getByLabelText(/kilometres/i), '100')

    // FY2027's published rate is 91c/km: 100km = $91.00.
    expect(await screen.findByText('$91.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input).toMatchObject({
      description: 'Client visits',
      amount_cents: 91_00,
      basis: 'distance',
      distance_km: 100,
    })
  })

  it('warns when the distance exceeds the ATO cap for the cents-per-km method', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByText('Distance (km)'))
    await user.type(screen.getByLabelText(/kilometres/i), '6000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/5,000km cap/i)
  })

  it('prefills an existing distance-basis deduction on the distance control', () => {
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction({ basis: 'distance', distance_km: 250, amount_cents: 227_50 })}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/kilometres/i)).toHaveValue('250 km')
    expect(screen.getByText('$227.50')).toBeInTheDocument()
  })

  it('offers no basis toggle when editing', () => {
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByText('Distance (km)')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Dollar' })).not.toBeInTheDocument()
  })

  it('keeps the basis an existing deduction was created with when saving', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction({ basis: 'distance', distance_km: 250, amount_cents: 227_50 })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ basis: 'distance', distance_km: 250 }),
        }),
      ),
    )
  })
})

describe('DeductionForm receipt extraction', () => {
  it('pre-fills the fields read off an attached receipt and saves them in cents', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)

    expect(screen.getByLabelText(/description/i)).toHaveValue('Officeworks')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$124.50')

    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submission = submitted(onSubmit)
    expect(submission.input).toMatchObject({
      description: 'Officeworks',
      amount_cents: 124_50,
      deduction_date: '2026-08-05',
    })
    // The receipt was stored before it was read, so the save carries the same
    // storage path the deduction id is filed under.
    expect(submission.receiptPath).toBe(`h1/${submission.id}/uuid-receipt.pdf`)
    expect(read).toHaveBeenCalledWith(submission.receiptPath, 'work_expense')
  })

  it('says the details were extracted and asks for a check, without restating them', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'read',
      // The receipt printed no readable amount, so it stays blank for the
      // member to type — never guessed at.
      extraction: extraction({ amount_cents: null }),
    } satisfies ExtractionOutcome)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    const note = screen.getByText(/extracted from the receipt by AI/i)
    expect(note).toHaveTextContent(/check them against it before saving/i)
    expect(note).not.toHaveTextContent(/Officeworks/i)
    expect(screen.getByLabelText(/description/i)).toHaveValue('Officeworks')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('')
  })

  it('says plainly when a receipt yielded nothing to fill in', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'read',
      extraction: { model: 'claude-haiku-4-5-20251001', fields: {} },
    } satisfies ExtractionOutcome)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(
      screen.getByText(/Nothing on the receipt could be filled in for you\./),
    ).toBeInTheDocument()
  })

  it('keeps a value the member typed rather than replacing it with a read one', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'My own label')
    await attach(user)

    expect(screen.getByLabelText(/description/i)).toHaveValue('My own label')
    // The amount was left alone, so it still fills from the receipt.
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$124.50')

    await user.click(screen.getByRole('button', { name: /add deduction/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.description).toBe('My own label')
  })

  it('replaces the picked receipt, discarding the first object and reading the second', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user, 'first.pdf')
    const first = (await upload.mock.results[0]!.value) as string
    await attach(user, 'second.pdf')

    expect(discard).toHaveBeenCalledWith(first)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenLastCalledWith(expect.stringContaining('second.pdf'), 'work_expense')
    expect(screen.getAllByText('Receipt attached')).toHaveLength(1)
  })

  it('removes the picked receipt, discarding its stored object', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)
    const path = (await upload.mock.results[0]!.value) as string
    await user.click(screen.getByRole('button', { name: /remove receipt/i }))

    await waitFor(() => expect(discard).toHaveBeenCalledWith(path))
    expect(screen.queryByText('Receipt attached')).not.toBeInTheDocument()
  })

  it('says so while the receipt is being stored and read', async () => {
    const user = userEvent.setup({ delay: null })
    let finishRead!: (outcome: ExtractionOutcome) => void
    read.mockReturnValue(
      new Promise<ExtractionOutcome>((resolve) => {
        finishRead = resolve
      }),
    )
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await user.upload(filePicker(), new File(['x'], 'receipt.pdf', { type: 'application/pdf' }))

    expect(await screen.findByText('Reading the receipt…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add deduction/i })).toBeDisabled()

    finishRead({ status: 'read', extraction: extraction() })
    await waitFor(() => expect(screen.queryByText('Reading the receipt…')).not.toBeInTheDocument())
  })

  it('falls back to manual entry with an honest note when extraction is not configured', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'not-configured',
      message: EXTRACTION_UNCONFIGURED_MESSAGE,
    } satisfies ExtractionOutcome)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(screen.getByText(EXTRACTION_UNCONFIGURED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
  })

  it('attaches a file the model cannot read, with a note, and the details are typed by hand', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await user.upload(filePicker(), new File(['x'], 'invoice.docx'))

    expect(await screen.findByText(/can't be read automatically/i)).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByText('Receipt attached')).toBeInTheDocument()
  })

  it('reads an account out of credit as reading being off, not as a broken read', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'out-of-credit',
      message: EXTRACTION_OUT_OF_CREDIT_MESSAGE,
    } satisfies ExtractionOutcome)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    const note = screen.getByText(EXTRACTION_OUT_OF_CREDIT_MESSAGE)
    expect(note.closest('[role="alert"]')).toBeNull()
    expect(screen.queryByText(EXTRACTION_UNCONFIGURED_MESSAGE)).not.toBeInTheDocument()
  })

  it('reads a refused API key as reading being off, not as a broken read', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'key-rejected',
      message: EXTRACTION_KEY_REJECTED_MESSAGE,
    } satisfies ExtractionOutcome)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    const note = screen.getByText(EXTRACTION_KEY_REJECTED_MESSAGE)
    expect(note.closest('[role="alert"]')).toBeNull()
  })

  it('passes on the model’s reason for a file that is not a receipt', async () => {
    const user = userEvent.setup({ delay: null })
    read.mockResolvedValue({
      status: 'not-receipt',
      message: 'That file does not look like a receipt.',
      reason: 'It is a bank statement.',
    } satisfies ExtractionOutcome)
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(
      screen.getByText(
        /does not look like a receipt\. It is a bank statement\. Enter the details by hand\./,
      ),
    ).toBeInTheDocument()
  })

  it('reports a receipt that could not be stored, and reads nothing', async () => {
    const user = userEvent.setup({ delay: null })
    upload.mockRejectedValue(new Error('nope'))
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)

    expect(screen.getByText(/Could not upload this receipt/)).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
  })

  it('deletes an attached receipt the member walks away from', async () => {
    const user = userEvent.setup({ delay: null })
    const { unmount } = render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)
    unmount()
    await waitFor(() => expect(discard).toHaveBeenCalledTimes(1))
  })

  it('keeps the stored receipt once the save that references it succeeds', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    const { unmount } = render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

    await attach(user)
    await user.click(screen.getByRole('button', { name: /add deduction/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    unmount()

    expect(discard).not.toHaveBeenCalled()
  })

  it('keeps the stored receipt when the save closes the form itself', async () => {
    const user = userEvent.setup({ delay: null })
    function ClosingDeductionForm({
      onSaved,
    }: {
      onSaved: (submission: DeductionSubmission) => Promise<void>
    }) {
      const [open, setOpen] = useState(true)
      if (!open) {
        return <p>Saved</p>
      }
      return (
        <DeductionForm
          member={member}
          attachments={attachments}
          financialYear={2027}
          onSubmit={async (submission) => {
            await onSaved(submission)
            setOpen(false)
          }}
        />
      )
    }
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<ClosingDeductionForm onSaved={onSaved} />)

    await attach(user)
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it('blocks a save while a receipt is still being stored', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    let finishUpload!: () => void
    upload.mockImplementation(
      async (deductionId: string, file: File) =>
        await new Promise<string>((resolve) => {
          finishUpload = () => resolve(`h1/${deductionId}/uuid-${file.name}`)
        }),
    )
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '10')
    await user.upload(filePicker(), new File(['x'], 'receipt.pdf', { type: 'application/pdf' }))

    const submit = await screen.findByRole('button', { name: /add deduction/i })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()

    finishUpload()
    await waitFor(() => expect(submit).not.toBeDisabled())
  })
})

describe('DeductionForm work-use apportioning', () => {
  it('claims the full amount at the default 100% work use', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Union fees')
    await user.type(screen.getByLabelText(/^amount/i), '500')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            amount_cents: 500_00,
            full_amount_cents: 500_00,
            work_use_percent: 100,
          }),
        }),
      ),
    )
    // No computed-amount note at the default: it would just repeat the typed figure.
    expect(screen.queryByText(/deductible amount/i)).not.toBeInTheDocument()
  })

  it('apportions a part-private expense and shows the claimable amount', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Phone plan')
    await user.type(screen.getByLabelText(/^amount/i), '100')
    await user.clear(screen.getByLabelText(/work use/i))
    await user.type(screen.getByLabelText(/work use/i), '60')

    expect(await screen.findByText('$60.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            amount_cents: 60_00,
            full_amount_cents: 100_00,
            work_use_percent: 60,
          }),
        }),
      ),
    )
  })

  it('will not save an amount-basis deduction with no work-use percent', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Phone plan')
    await user.type(screen.getByLabelText(/^amount/i), '100')
    await user.clear(screen.getByLabelText(/work use/i))
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('reopens a part-claimed deduction on its full cost, not the apportioned figure', () => {
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction({
          amount_cents: 60_00,
          full_amount_cents: 100_00,
          work_use_percent: 60,
        })}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/^amount/i)).toHaveValue('$100.00')
    expect(screen.getByLabelText(/work use/i)).toHaveValue('60%')
    expect(screen.getByText('$60.00')).toBeInTheDocument()
  })

  it('pins work use at 100% on the distance basis regardless of the field', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.type(screen.getByLabelText(/description/i), 'Client visits')
    // Set a part-private percentage on the amount basis, then switch to distance.
    await user.clear(screen.getByLabelText(/work use/i))
    await user.type(screen.getByLabelText(/work use/i), '60')
    await user.click(screen.getByText('Distance (km)'))
    await user.type(screen.getByLabelText(/kilometres/i), '100')

    // The work-use field disappears with the amount basis it belongs to.
    expect(screen.queryByLabelText(/work use/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ work_use_percent: 100 }),
        }),
      ),
    )
  })
})

describe('DeductionForm category', () => {
  it('defaults to a work expense, with the work-use field shown', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    expect(screen.getByLabelText(/work use/i)).toBeInTheDocument()
  })

  it('hides the work-use field and pins it at 100% for a donation', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByText('Donation'))
    // A non-sequitur on a donation: it's claimed in full or not at all.
    expect(screen.queryByLabelText(/work use/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/description/i), 'Red Cross')
    await user.type(screen.getByLabelText(/^amount/i), '250')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            category: 'donation',
            amount_cents: 250_00,
            full_amount_cents: 250_00,
            work_use_percent: 100,
          }),
        }),
      ),
    )
  })

  it('hides the work-use field and pins it at 100% for tax agent fees', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByText('Tax agent fee'))
    expect(screen.queryByLabelText(/work use/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/description/i), 'Accountant')
    await user.type(screen.getByLabelText(/^amount/i), '400')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            category: 'tax_agent_fees',
            amount_cents: 400_00,
            work_use_percent: 100,
          }),
        }),
      ),
    )
  })

  it('primes extraction with the chosen category before the file is read', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByText('Donation'))
    await attach(user)

    expect(read).toHaveBeenCalledWith(expect.any(String), 'donation')
  })

  it('keeps an existing deduction on its category, with no control to change it', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction({ category: 'donation' })}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.queryByLabelText('What kind of deduction?')).not.toBeInTheDocument()
    expect(screen.queryByText('Tax agent fee')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ category: 'donation' }),
        }),
      ),
    )
  })

  it('reopens an existing donation on its own category, with the work-use field hidden', () => {
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        initial={makeDeduction({ category: 'donation' })}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText(/work use/i)).not.toBeInTheDocument()
  })

  it('saves a new donation with no group, for the trigger to file into the donations group', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        groups={[makeGroup({ id: 'gx', name: 'Red Cross monthly' })]}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByText('Donation'))
    await user.type(screen.getByLabelText(/description/i), 'Red Cross')
    await user.type(screen.getByLabelText(/^amount/i), '250')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ category: 'donation', group_id: null }),
        }),
      ),
    )
  })

  it('offers a donation no group picker', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        groups={[makeGroup({ id: 'gx', name: 'Red Cross monthly' })]}
        onSubmit={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    expect(screen.getByRole('combobox', { name: 'Group' })).toBeInTheDocument()
    await user.click(screen.getByText('Donation'))
    expect(screen.queryByRole('combobox', { name: 'Group' })).not.toBeInTheDocument()
  })

  it('lists only standard groups for a work expense, with None', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        groups={[
          makeGroup({ id: 'gd', name: 'Donations', kind: 'donations' }),
          makeGroup({ id: 'gx', name: 'Red Cross monthly' }),
        ]}
        onSubmit={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Red Cross monthly' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Donations' })).not.toBeInTheDocument()
  })

  it('offers a group named Donations that the member made, since it is a standard group', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        groups={[makeGroup({ id: 'gd', name: 'Donations' })]}
        onSubmit={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    expect(screen.getByRole('option', { name: 'Donations' })).toBeInTheDocument()
  })

  it('adds only donations from the donations group', () => {
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        groupId="gd"
        groups={[makeGroup({ id: 'gd', name: 'Donations', kind: 'donations' })]}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('What kind of deduction?')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/work use/i)).not.toBeInTheDocument()
  })

  it('offers no donation category when adding to a standard group', () => {
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        groupId="gx"
        groups={[makeGroup({ id: 'gx' })]}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByText('Donation')).not.toBeInTheDocument()
    expect(screen.getByText('Work expense')).toBeInTheDocument()
  })

  it('offers the dollar/distance basis toggle for a work expense only', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    expect(screen.getByText('Distance (km)')).toBeInTheDocument()

    await user.click(screen.getByText('Donation'))
    expect(screen.queryByText('Distance (km)')).not.toBeInTheDocument()

    await user.click(screen.getByText('Tax agent fee'))
    expect(screen.queryByText('Distance (km)')).not.toBeInTheDocument()
  })

  it('forces the amount basis when a work expense on the distance basis is switched to a donation', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))

    await user.click(screen.getByText('Distance (km)'))
    await user.type(screen.getByLabelText(/kilometres/i), '100')
    await user.click(screen.getByText('Donation'))

    // The distance field is gone with the basis it belonged to; a plain dollar
    // amount takes its place.
    expect(screen.queryByLabelText(/kilometres/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/description/i), 'Red Cross')
    await user.type(screen.getByLabelText(/^amount/i), '250')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            category: 'donation',
            basis: 'amount',
            distance_km: null,
            amount_cents: 250_00,
          }),
        }),
      ),
    )
  })
})

describe('DeductionForm receipt-first start', () => {
  function renderAdd(props: Partial<ComponentProps<typeof DeductionForm>> = {}) {
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
        {...props}
      />,
    )
    return { onSubmit, user: userEvent.setup({ delay: null }) }
  }
  const manualButton = () => screen.getByRole('button', { name: /enter details manually/i })
  const fieldsShown = () => screen.queryByLabelText(/description/i) !== null
  const drop = (...files: File[]) => {
    const area = screen.getByRole('group', { name: 'Drop files here' })
    fireEvent.drop(area, { dataTransfer: { types: ['Files'], files } })
  }
  const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' })

  it('opens on the receipt prompt alone, with entering details by hand as the secondary choice', () => {
    renderAdd()

    expect(screen.getByLabelText('What kind of deduction?')).toBeInTheDocument()
    expect(filePicker()).toBeInTheDocument()
    expect(screen.getByText(/we'll read the details for you to check/i)).toBeInTheDocument()
    expect(manualButton()).toBeInTheDocument()
    expect(fieldsShown()).toBe(false)
    expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Entry basis')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add deduction/i })).toBeDisabled()
  })

  it('reveals the fields, and drops the manual choice, once the member chooses to type', async () => {
    const { user } = renderAdd()

    await user.click(manualButton())

    expect(fieldsShown()).toBe(true)
    expect(screen.queryByRole('button', { name: /enter details manually/i })).toBeNull()
    expect(screen.getByLabelText('Entry basis')).toBeInTheDocument()
  })

  it('reveals the fields prefilled once a receipt has been read, and keeps them if it is removed', async () => {
    const { user } = renderAdd()

    await user.upload(filePicker(), pdf('r.pdf'))
    expect(await screen.findByLabelText(/description/i)).toHaveValue('Officeworks')
    expect(screen.getByText(/extracted from the receipt by AI/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove receipt' }))

    expect(screen.getByLabelText(/description/i)).toHaveValue('Officeworks')
  })

  it('shows the fields with the hand-entry note when the receipt cannot be read', async () => {
    read.mockResolvedValue({
      status: 'not-configured',
      message: EXTRACTION_UNCONFIGURED_MESSAGE,
    } satisfies ExtractionOutcome)
    const { user } = renderAdd()

    await user.upload(filePicker(), pdf('r.pdf'))

    expect(await screen.findByText(EXTRACTION_UNCONFIGURED_MESSAGE)).toBeInTheDocument()
    expect(fieldsShown()).toBe(true)
  })

  it('shows the fields for a file type that cannot be read', async () => {
    const { user } = renderAdd()

    await user.upload(filePicker(), new File(['x'], 'invoice.docx'))

    expect(await screen.findByText(/can't be read automatically/i)).toBeInTheDocument()
    expect(fieldsShown()).toBe(true)
  })

  it('keeps the prompt while a receipt is being stored, with no manual choice to take', async () => {
    let finishUpload!: () => void
    upload.mockImplementation(
      async (id: string, file: File) =>
        await new Promise<string>((resolve) => {
          finishUpload = () => resolve(`h1/${id}/${file.name}`)
        }),
    )
    const { user } = renderAdd()

    await user.upload(filePicker(), pdf('r.pdf'))

    expect(screen.getByText(/storing the receipt/i)).toBeInTheDocument()
    expect(manualButton()).toBeDisabled()
    expect(fieldsShown()).toBe(false)
    drop(pdf('late.pdf'))
    expect(upload).toHaveBeenCalledTimes(1)

    finishUpload()
    await screen.findByLabelText(/description/i)
  })

  it('opens a form inside a group, and an edit, on its fields', () => {
    renderAdd({ groupId: 'g1', groups: [makeGroup()] })
    expect(fieldsShown()).toBe(true)
    expect(screen.queryByRole('button', { name: /enter details manually/i })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Drop files here' })).toBeNull()
  })

  it('opens a draft read by a bulk upload on its fields', () => {
    renderAdd({
      draft: { id: 'd9', path: 'p', extraction: extraction(), category: 'work_expense' },
    })
    expect(fieldsShown()).toBe(true)
    expect(filePicker()).toBeNull()
  })

  it('reads a single receipt picked or dropped on the card, even where several are welcome', async () => {
    const onAddFiles = vi.fn()
    const { user } = renderAdd({ onAddFiles })

    await user.upload(filePicker(), pdf('one.pdf'))
    expect(await screen.findByLabelText(/description/i)).toHaveValue('Officeworks')
    expect(onAddFiles).not.toHaveBeenCalled()
  })

  it('hands several receipts picked together to the bulk upload as the chosen kind, and closes', async () => {
    const onAddFiles = vi.fn()
    const onCancel = vi.fn()
    const { user } = renderAdd({ onAddFiles, onCancel })
    await user.click(screen.getByText('Donation'))

    await user.upload(filePicker(), [pdf('a.pdf'), pdf('b.pdf')])

    expect(onAddFiles).toHaveBeenCalledWith([expect.any(File), expect.any(File)], 'donation')
    expect(onCancel).toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('hands several receipts dropped on the card to the bulk upload', () => {
    const onAddFiles = vi.fn()
    renderAdd({ onAddFiles })

    drop(pdf('a.pdf'), pdf('b.pdf'))

    expect(onAddFiles).toHaveBeenCalledWith([expect.any(File), expect.any(File)], 'work_expense')
  })

  it('hands several receipts over without a form to close', async () => {
    const onAddFiles = vi.fn()
    const { user } = renderAdd({ onAddFiles })

    await user.upload(filePicker(), [pdf('a.pdf'), pdf('b.pdf')])

    expect(onAddFiles).toHaveBeenCalled()
  })

  it('reads one receipt dropped on the card, and ignores an empty drop', async () => {
    renderAdd()

    drop()
    expect(upload).not.toHaveBeenCalled()
    drop(pdf('dropped.pdf'))

    expect(await screen.findByLabelText(/description/i)).toHaveValue('Officeworks')
  })

  it('takes the first of several receipts where no bulk upload is offered', async () => {
    renderAdd()

    drop(pdf('a.pdf'), pdf('b.pdf'))

    await screen.findByLabelText(/description/i)
    expect(upload).toHaveBeenCalledTimes(1)
  })
})
