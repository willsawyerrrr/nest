import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import { useDeductionReceiptQueue } from '../hooks/useDeductionReceiptQueue'
import type { DeductionCategory, DeductionSubmission } from '../hooks/useDeductions'
import { EXTRACTION_KEY_REJECTED_MESSAGE } from '../lib/deductionExtraction'
import { render, screen, waitFor, within } from '../test/render'
import { DeductionReceiptImport } from './DeductionReceiptImport'

const PICKER = 'Receipts'
const member = { id: 'm1', name: 'Will' }

const upload = vi.fn()
const discard = vi.fn()
const read = vi.fn()
const attachments: DeductionAttachments = { upload, discard, read }

function receipt(name: string) {
  return new File(['x'], name, { type: 'application/pdf' })
}

/** Stands in for the Add deduction card's file input, which feeds the queue. */
function Harness({
  category,
  onCreate,
}: {
  category: DeductionCategory
  onCreate: (submission: DeductionSubmission) => Promise<void>
}) {
  const queue = useDeductionReceiptQueue(attachments)
  return (
    <>
      <input
        type="file"
        multiple
        aria-label={PICKER}
        onChange={(event) => queue.add([...(event.currentTarget.files ?? [])], category)}
      />
      <DeductionReceiptImport
        queue={queue}
        member={member}
        attachments={attachments}
        financialYear={2026}
        groups={[]}
        onCreate={onCreate}
      />
    </>
  )
}

function setup(category: DeductionCategory = 'work_expense') {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  render(<Harness category={category} onCreate={onCreate} />)
  return { onCreate, user: userEvent.setup({ delay: null }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockImplementation(async (id: string, file: File) => `h1/${id}/${file.name}`)
  discard.mockResolvedValue(undefined)
  read.mockImplementation(async (path: string) => ({
    status: 'read',
    extraction: {
      model: 'm',
      fields: path.endsWith('b.pdf')
        ? {}
        : { description: 'Monitor', amount_cents: 450_00, deduction_date: '2026-08-02' },
    },
  }))
})

describe('DeductionReceiptImport', () => {
  it('reads each receipt into its own deduction draft, as the chosen kind', async () => {
    const { user } = setup('donation')
    await user.upload(screen.getByLabelText(PICKER), [receipt('a.pdf'), receipt('b.pdf')])

    await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(2))
    expect(read).toHaveBeenCalledWith(expect.stringMatching(/a\.pdf$/), 'donation')
    const first = screen.getByLabelText('a.pdf')
    expect(within(first).getByLabelText('Description')).toHaveValue('Monitor')
    expect(within(first).getByLabelText('Amount')).toHaveValue('$450.00')
    expect(within(first).getByText(/extracted from the receipt by AI/i)).toBeInTheDocument()
    expect(within(screen.getByLabelText('b.pdf')).getByLabelText('Description')).toHaveValue('')
    expect(
      within(screen.getByLabelText('b.pdf')).getByText(/nothing on the receipt/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Receipt')).not.toBeInTheDocument()
  })

  it('saves every ready draft with its own stored receipt', async () => {
    const { onCreate, user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [receipt('a.pdf'), receipt('b.pdf')])
    await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(2))
    // The second receipt gave nothing, so it needs its details first.
    await user.type(within(screen.getByLabelText('b.pdf')).getByLabelText('Description'), 'Pens')
    await user.type(within(screen.getByLabelText('b.pdf')).getByLabelText('Amount'), '12')

    await user.click(screen.getByRole('button', { name: /save selected \(2\)/i }))

    expect(await screen.findByText(/^Saved 2\./)).toBeInTheDocument()
    const [first] = onCreate.mock.calls.map(([submission]) => submission)
    expect(first).toMatchObject({
      receiptPath: `h1/${first.id}/a.pdf`,
      input: { description: 'Monitor', amount_cents: 450_00, category: 'work_expense' },
    })
  })

  it('leaves a draft with no details unsaved and says it needs a look', async () => {
    const { onCreate, user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [receipt('b.pdf')])
    await screen.findByLabelText('Description')

    await user.click(screen.getByRole('button', { name: /save selected/i }))

    expect(await screen.findByText(/1 file needs another look/i)).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('attaches a file the model cannot read for hand entry', async () => {
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [new File(['x'], 'invoice.docx')])

    expect(await screen.findByText('Unsupported type')).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Description')).toHaveValue('')
  })

  it('stops the queue when the API key is refused', async () => {
    read.mockResolvedValue({ status: 'key-rejected', message: EXTRACTION_KEY_REJECTED_MESSAGE })
    const { user } = setup()
    await user.upload(
      screen.getByLabelText(PICKER),
      ['a', 'b', 'c', 'd'].map((n) => receipt(`${n}.pdf`)),
    )

    expect(await screen.findByText('Reading has stopped')).toBeInTheDocument()
    expect(read.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('shows a file that is not a receipt as unreadable, with its reason', async () => {
    read.mockResolvedValue({
      status: 'not-receipt',
      message: 'That file does not look like a receipt.',
      reason: null,
    })
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [receipt('a.pdf')])

    expect(await screen.findByText(/does not look like a receipt\./)).toBeInTheDocument()
    expect(screen.getByText("Couldn't be read")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove a\.pdf/i }))
    expect(screen.queryByLabelText('a.pdf')).not.toBeInTheDocument()
  })

  it('discards a draft and deletes its stored receipt', async () => {
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [receipt('a.pdf')])
    await screen.findByLabelText('Description')

    await user.click(screen.getByRole('button', { name: /^discard$/i }))

    await waitFor(() => expect(discard).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('a.pdf')).not.toBeInTheDocument()
  })
})
