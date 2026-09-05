import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DocumentIntakeRow } from '../hooks/useDocumentIntake'
import type { ExtractionOutcome } from '../lib/deductionExtraction'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { DeductionIntakeInbox } from './DeductionIntakeInbox'

const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

function makeItem(overrides: Partial<DocumentIntakeRow> = {}): DocumentIntakeRow {
  return {
    id: 'i1',
    household_id: 'h1',
    member_id: 'm1',
    kind: 'deduction',
    storage_path: 'h1/i1/receipt.pdf',
    original_filename: 'receipt.pdf',
    created_at: '2027-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeGroup(overrides: Partial<DeductionGroupRow> = {}): DeductionGroupRow {
  return {
    id: 'g1',
    household_id: 'h1',
    member_id: 'm1',
    name: 'Adobe Creative Cloud',
    financial_year: 2027,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()
const attachments: DeductionAttachments = { upload, discard, read }

const download = vi.fn()
const clear = vi.fn()

/** The file every `download` resolves to, ready to hand to the add-deduction form. */
const downloadedFile = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(async (deductionId: string, file: File) => ({
    storage_path: `h1/${deductionId}/uuid-${file.name}`,
    file_name: file.name,
  }))
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({
    status: 'read',
    extraction: { model: 'claude-haiku-4-5-20251001', fields: {} },
  } satisfies ExtractionOutcome)
  download.mockResolvedValue(downloadedFile)
  clear.mockResolvedValue(undefined)
})

function renderInbox(overrides: Partial<Parameters<typeof DeductionIntakeInbox>[0]> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const props = {
    members: [will, sam],
    groups: [] as DeductionGroupRow[],
    attachments,
    financialYear: 2027,
    documentIntake: { items: [makeItem()], download, clear },
    onCreate,
    ...overrides,
  }
  render(<DeductionIntakeInbox {...props} />)
  return props
}

/** The review form's group picker, present only when the member has groups. */
function groupPicker() {
  return screen.getByRole('combobox', { name: 'Group' })
}

describe('DeductionIntakeInbox', () => {
  it('only offers items staged for deductions, leaving payslip items to the Payslips tab', () => {
    renderInbox({
      documentIntake: {
        items: [makeItem({ id: 'i1', kind: 'deduction' }), makeItem({ id: 'i2', kind: 'payslip' })],
        download,
        clear,
      },
    })
    expect(screen.getAllByRole('button', { name: /review/i })).toHaveLength(1)
  })

  it('downloads a staged file and opens it in the add-deduction form for its member', async () => {
    const user = userEvent.setup()
    const item = makeItem({ member_id: 'm2' })
    renderInbox({ documentIntake: { items: [item], download, clear } })

    await user.click(screen.getByRole('button', { name: /review/i }))

    expect(download).toHaveBeenCalledWith(item)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Review deduction')
    // The downloaded file drives the same store-and-read pipeline a picked
    // receipt would, pre-filling the form exactly as attaching it by hand would.
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(String), downloadedFile))
  })

  it('shows an error when the download fails, and never opens the form', async () => {
    const user = userEvent.setup()
    download.mockRejectedValue(new Error('nope'))
    renderInbox()

    await user.click(screen.getByRole('button', { name: /review/i }))

    expect(await screen.findByText(/could not download this document/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dismisses a staged item without downloading or opening the form', async () => {
    const user = userEvent.setup()
    const item = makeItem()
    renderInbox({ documentIntake: { items: [item], download, clear } })

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    await waitFor(() => expect(clear).toHaveBeenCalledWith(item))
    expect(download).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an error when dismissing fails', async () => {
    const user = userEvent.setup()
    clear.mockRejectedValue(new Error('nope'))
    renderInbox()

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(await screen.findByText(/could not dismiss this document/i)).toBeInTheDocument()
  })

  it('closes the review modal on cancel, leaving the item staged for another look', async () => {
    const user = userEvent.setup()
    renderInbox()

    await user.click(screen.getByRole('button', { name: /review/i }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clear).not.toHaveBeenCalled()
  })

  it('closes the review modal via its own close control too, leaving the item staged', async () => {
    const user = userEvent.setup()
    renderInbox()

    await user.click(screen.getByRole('button', { name: /review/i }))
    await screen.findByRole('dialog')
    // Mantine's own close button carries no accessible name of its own.
    await user.click(document.querySelector('.mantine-Modal-close')!)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clear).not.toHaveBeenCalled()
  })

  it('offers only the reviewing member’s own groups in the review form', async () => {
    const user = userEvent.setup()
    renderInbox({
      documentIntake: { items: [makeItem({ member_id: 'm2' })], download, clear },
      groups: [
        makeGroup({ id: 'g1', member_id: 'm1', name: 'Will’s subscription' }),
        makeGroup({ id: 'g2', member_id: 'm2', name: 'Sam’s subscription' }),
      ],
    })

    await user.click(screen.getByRole('button', { name: /review/i }))
    await screen.findByRole('dialog')
    await user.click(groupPicker())

    expect(await screen.findByRole('option', { name: 'Sam’s subscription' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Will’s subscription' })).not.toBeInTheDocument()
  })

  it('creates the deduction, clears the staged item, and closes the form on save', async () => {
    const user = userEvent.setup()
    const item = makeItem()
    const { onCreate } = renderInbox({ documentIntake: { items: [item], download, clear } })

    await user.click(screen.getByRole('button', { name: /review/i }))
    await screen.findByRole('dialog')
    await waitFor(() => expect(upload).toHaveBeenCalled())

    await user.type(screen.getByLabelText(/description/i), 'Home office')
    await user.type(screen.getByLabelText(/^amount/i), '100')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ member_id: 'm1' }) }),
    )
    await waitFor(() => expect(clear).toHaveBeenCalledWith(item))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
