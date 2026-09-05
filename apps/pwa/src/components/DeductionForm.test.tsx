import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionRow, DeductionSubmission } from '../hooks/useDeductions'
import {
  EXTRACTION_KEY_REJECTED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  type DeductionExtraction,
  type ExtractionOutcome,
} from '../lib/deductionExtraction'
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
  upload.mockImplementation(async (deductionId: string, file: File) => ({
    storage_path: `h1/${deductionId}/uuid-${file.name}`,
    file_name: file.name,
  }))
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
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '350')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const submission = submitted(onSubmit)
    expect(submission.id).toEqual(expect.any(String))
    expect(submission.input).toMatchObject({
      member_id: 'm1',
      description: 'Tools',
      amount_cents: 35000,
    })
    expect(submission.input.deduction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(submission.receipts).toEqual([])
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

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

  it('prefills an existing deduction, offers no receipt picker, and cancels', async () => {
    const user = userEvent.setup()
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
    // Editing carries no attachment mechanics: receipts for an existing
    // deduction are managed from its row in the list, not from this form.
    expect(filePicker()).toBeNull()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('submits the resubmitted fields for an edit, with the deduction’s own id', async () => {
    const user = userEvent.setup()
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
        full_amount_cents: 1_200_00,
        work_use_percent: 100,
      },
      receipts: [],
    })
    expect(upload).not.toHaveBeenCalled()
  })

  it('computes the amount from distance at the FY2027 cents-per-km rate on the distance basis', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

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
    const user = userEvent.setup()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

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
})

describe('DeductionForm receipt extraction', () => {
  it('pre-fills the fields read off an attached receipt and saves them in cents', async () => {
    const user = userEvent.setup()
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
    expect(submission.receipts).toEqual([
      { storage_path: `h1/${submission.id}/uuid-receipt.pdf`, file_name: 'receipt.pdf' },
    ])
    expect(read).toHaveBeenCalledWith(submission.receipts[0]!.storage_path)
  })

  it('says the details were extracted and asks for a check, without restating them', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/description/i), 'My own label')
    await attach(user)

    expect(screen.getByLabelText(/description/i)).toHaveValue('My own label')
    // The amount was left alone, so it still fills from the receipt.
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$124.50')

    await user.click(screen.getByRole('button', { name: /add deduction/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).input.description).toBe('My own label')
  })

  it('only reads the first of several attached receipts', async () => {
    const user = userEvent.setup()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user, 'first.pdf')
    await attach(user, 'second.pdf')

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(expect.stringContaining('first.pdf'))
    expect(screen.getByDisplayValue('first.pdf')).toBeInTheDocument()
    expect(screen.getByDisplayValue('second.pdf')).toBeInTheDocument()
  })

  it('removes a picked receipt, discarding its stored object', async () => {
    const user = userEvent.setup()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={vi.fn()}
      />,
    )

    await attach(user)
    const path = (await upload.mock.results[0]!.value).storage_path as string
    await user.click(screen.getByRole('button', { name: /remove receipt 1/i }))

    await waitFor(() => expect(discard).toHaveBeenCalledWith(path))
    expect(screen.queryByDisplayValue('receipt.pdf')).not.toBeInTheDocument()
  })

  it('says so while the receipt is being stored and read', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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

  it('reads an account out of credit as reading being off, not as a broken read', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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

  it('keeps every stored receipt once the save that references them succeeds', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    let finishUpload!: (stored: { storage_path: string; file_name: string }) => void
    upload.mockImplementation(
      async (deductionId: string, file: File) =>
        await new Promise<{ storage_path: string; file_name: string }>((resolve) => {
          finishUpload = () =>
            resolve({ storage_path: `h1/${deductionId}/uuid-${file.name}`, file_name: file.name })
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

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '10')
    await user.upload(filePicker(), new File(['x'], 'receipt.pdf', { type: 'application/pdf' }))

    const submit = await screen.findByRole('button', { name: /add deduction/i })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()

    finishUpload({ storage_path: 'h1/x/uuid-receipt.pdf', file_name: 'receipt.pdf' })
    await waitFor(() => expect(submit).not.toBeDisabled())
  })
})

describe('DeductionForm receipt names', () => {
  /** Saves the deduction — the read having filled its fields — and returns the receipts saved. */
  async function saveReceipts(
    user: ReturnType<typeof userEvent.setup>,
    onSubmit: ReturnType<typeof vi.fn>,
  ) {
    await user.click(screen.getByRole('button', { name: /add deduction/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    return submitted(onSubmit).receipts
  }

  it('stores an attached receipt under the name the member types', async () => {
    const user = userEvent.setup()
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
    const name = screen.getByRole('textbox', { name: /receipt 1 name/i })
    expect(name).toHaveValue('receipt.pdf')
    await user.clear(name)
    await user.type(name, '  Officeworks invoice  ')

    // The typed name is trimmed, and the file itself stays where it was stored.
    expect(await saveReceipts(user, onSubmit)).toEqual([
      {
        storage_path: expect.stringContaining('uuid-receipt.pdf'),
        file_name: 'Officeworks invoice',
      },
    ])
  })

  it('stores a receipt left with no name as Receipt', async () => {
    const user = userEvent.setup()
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
    await user.clear(screen.getByRole('textbox', { name: /receipt 1 name/i }))

    expect(await saveReceipts(user, onSubmit)).toEqual([
      { storage_path: expect.any(String), file_name: 'Receipt' },
    ])
  })

  it('names each attached receipt on its own', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

    await attach(user, 'first.pdf')
    await attach(user, 'second.pdf')
    await user.clear(screen.getByRole('textbox', { name: /receipt 2 name/i }))
    await user.type(screen.getByRole('textbox', { name: /receipt 2 name/i }), 'Toolkit')

    expect(await saveReceipts(user, onSubmit)).toEqual([
      { storage_path: expect.stringContaining('first.pdf'), file_name: 'first.pdf' },
      { storage_path: expect.stringContaining('second.pdf'), file_name: 'Toolkit' },
    ])
  })
})

describe('DeductionForm work-use apportioning', () => {
  it('claims the full amount at the default 100% work use', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

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
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

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
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

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
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <DeductionForm
        member={member}
        attachments={attachments}
        financialYear={2027}
        onSubmit={onSubmit}
      />,
    )

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
