import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePayslipQueue } from '../hooks/usePayslipQueue'
import { EXTRACTION_OUT_OF_CREDIT_MESSAGE } from '../lib/payslipExtraction'
import {
  attachments,
  extraction,
  inflows,
  member,
  read,
  resetPayslipAttachmentMocks,
  upload,
} from '../test/payslipForm'
import { render, screen, waitFor, within } from '../test/render'
import { PayslipImport } from './PayslipImport'

const PICKER = 'Payslip documents'

function pdf(name: string) {
  return new File(['x'], name, { type: 'application/pdf' })
}

/** Stands in for the Add payslip card's file input, which feeds the queue. */
function Harness({ onCreate }: { onCreate: () => Promise<void> }) {
  const queue = usePayslipQueue(attachments)
  return (
    <>
      <input
        type="file"
        multiple
        aria-label={PICKER}
        onChange={(event) => queue.add([...(event.currentTarget.files ?? [])], undefined)}
      />
      <PayslipImport
        queue={queue}
        member={member}
        inflows={inflows}
        attachments={attachments}
        onCreate={onCreate}
      />
    </>
  )
}

function setup() {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  render(<Harness onCreate={onCreate} />)
  return { onCreate, user: userEvent.setup({ delay: null }) }
}

beforeEach(resetPayslipAttachmentMocks)

describe('PayslipImport', () => {
  it('reads each document into its own pre-filled payslip draft', async () => {
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [pdf('a.pdf'), pdf('b.pdf')])

    await waitFor(() => expect(screen.getAllByLabelText('Gross')).toHaveLength(2))
    expect(screen.getAllByLabelText('Gross')[0]).toHaveValue('$4,120.50')
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    expect(screen.getAllByText(/extracted from the document by AI/i)).toHaveLength(2)
    expect(screen.queryByLabelText('Payslip document')).not.toBeInTheDocument()
  })

  it('saves every ready draft under its own id with its stored document', async () => {
    const { onCreate, user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [pdf('a.pdf'), pdf('b.pdf')])
    await waitFor(() => expect(screen.getAllByLabelText('Gross')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: /save selected \(2\)/i }))

    expect(await screen.findByText(/^Saved 2\./)).toBeInTheDocument()
    const [first, second] = onCreate.mock.calls.map(([submission]) => submission)
    expect(first.id).not.toBe(second.id)
    expect(first.attachment).toEqual({ payslipId: first.id, path: `h1/${first.id}/uuid-a.pdf` })
    expect(first.input).toMatchObject({ gross_cents: 4_120_50, financial_year: 2027 })
  })

  it('names a draft that is not complete rather than saving it', async () => {
    read.mockResolvedValue({
      status: 'read',
      extraction: extraction({ fields: { gross_cents: 4_120_50 } }),
    })
    const { onCreate, user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [pdf('a.pdf')])
    await waitFor(() => expect(screen.getByLabelText('Gross')).toHaveValue('$4,120.50'))

    await user.click(screen.getByRole('button', { name: /save selected/i }))

    expect(await screen.findByText(/1 file needs another look/i)).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('attaches a file the model cannot read for the figures to be typed by hand', async () => {
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [new File(['x'], 'slip.xlsx')])

    expect(await screen.findByText('Unsupported type')).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Gross')).toHaveValue('')
    expect(screen.queryByText(/extracted from the document by AI/i)).not.toBeInTheDocument()
  })

  it('stops the queue with the fixed copy when the account is out of credit', async () => {
    read.mockResolvedValue({ status: 'out-of-credit', message: EXTRACTION_OUT_OF_CREDIT_MESSAGE })
    const { user } = setup()
    await user.upload(
      screen.getByLabelText(PICKER),
      ['a', 'b', 'c', 'd', 'e'].map((n) => pdf(`${n}.pdf`)),
    )

    expect(await screen.findByText('Reading has stopped')).toBeInTheDocument()
    expect(screen.getAllByText(EXTRACTION_OUT_OF_CREDIT_MESSAGE).length).toBeGreaterThan(1)
    expect(read.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('shows a document that is not a payslip as unreadable with its reason', async () => {
    read.mockResolvedValue({
      status: 'not-payslip',
      message: 'That file does not look like a payslip.',
      reason: 'It is a menu.',
    })
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [pdf('menu.pdf')])

    const card = await screen.findByLabelText('menu.pdf')
    expect(
      within(card).getByText(/does not look like a payslip\. It is a menu\./),
    ).toBeInTheDocument()
  })

  it('discards a draft and deletes its stored document', async () => {
    const { user } = setup()
    await user.upload(screen.getByLabelText(PICKER), [pdf('a.pdf')])
    await screen.findByLabelText('Gross')

    await user.click(screen.getByRole('button', { name: /^discard$/i }))

    await waitFor(() => expect(attachments.discard).toHaveBeenCalledTimes(1))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('a.pdf')).not.toBeInTheDocument()
  })
})
