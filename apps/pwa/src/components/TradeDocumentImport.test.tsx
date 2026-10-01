import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TradeRow } from '../hooks/useTrades'
import { FILE_TOO_LARGE_MESSAGE, MAX_UPLOAD_BYTES } from '../lib/uploadFile'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { TradeDocumentImport } from './TradeDocumentImport'

const will = makeMember({ id: 'm1', name: 'Will' })
const file = new File(['x'], 'note.pdf', { type: 'application/pdf' })

const buy = {
  values: {
    ticker: 'VAS',
    side: 'buy' as const,
    traded_on: '2026-07-06',
    units: 10.5,
    price_per_unit_cents: 98_50,
    fee_cents: 9_50,
  },
  check: [],
}
const sell = {
  values: { ticker: 'VGS', side: 'sell' as const, traded_on: '2026-07-07', units: 2 },
  check: ['price per unit'],
}

function actions(overrides = {}) {
  return {
    upload: vi.fn().mockResolvedValue('h1/d1/note.pdf'),
    discard: vi.fn().mockResolvedValue(undefined),
    extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy, sell] }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderImport(a = actions(), extra: { trades?: TradeRow[]; onClose?: () => void } = {}) {
  const onClose = extra.onClose ?? vi.fn()
  const view = render(
    <TradeDocumentImport
      file={file}
      member={will}
      trades={extra.trades ?? []}
      actions={a}
      onClose={onClose}
    />,
  )
  return { ...view, a, onClose }
}

describe('TradeDocumentImport', () => {
  it('shows a reading state, then a draft form for each trade read', async () => {
    const { a } = renderImport()
    expect(screen.getByText(/reading the document/i)).toBeInTheDocument()

    expect(await screen.findByText(/2 trades were extracted by AI/i)).toBeInTheDocument()
    expect(
      screen.getAllByLabelText(/^ticker$/i).map((input) => (input as HTMLInputElement).value),
    ).toEqual(['VAS', 'VGS'])
    expect(screen.getByText(/check the price per unit/i)).toBeInTheDocument()
    expect(a.upload).toHaveBeenCalledWith(expect.any(String), file)
    expect(a.extract).toHaveBeenCalledWith('h1/d1/note.pdf')
  })

  it('says when a single trade was read', async () => {
    renderImport(actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }))
    expect(await screen.findByText(/1 trade was extracted by AI/i)).toBeInTheDocument()
  })

  it('names several fields to check', async () => {
    renderImport(
      actions({
        extract: vi.fn().mockResolvedValue({
          status: 'read',
          trades: [{ values: {}, check: ['date', 'units'] }],
        }),
      }),
    )
    expect(await screen.findByText(/check the date, units/i)).toBeInTheDocument()
    expect(screen.getByText(/did not give them clearly/i)).toBeInTheDocument()
  })

  it('saves a confirmed draft against the document and keeps the rest', async () => {
    const user = userEvent.setup()
    const { a } = renderImport()
    await screen.findByText(/2 trades were extracted/i)

    await user.click(screen.getAllByRole('button', { name: /^save trade$/i })[0]!)

    await waitFor(() =>
      expect(a.save).toHaveBeenCalledWith({
        documentId: expect.any(String),
        path: 'h1/d1/note.pdf',
        id: expect.any(String),
        input: {
          member_id: 'm1',
          ticker: 'VAS',
          side: 'buy',
          traded_on: '2026-07-06',
          units: 10.5,
          price_per_unit_cents: 98_50,
          fee_cents: 9_50,
        },
      }),
    )
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(1))
    expect(screen.getByLabelText(/^ticker$/i)).toHaveValue('VGS')
  })

  it('discards a draft, and closes keeping the document once a trade was saved', async () => {
    const user = userEvent.setup()
    const { a, onClose, unmount } = renderImport()
    await screen.findByText(/2 trades were extracted/i)

    await user.click(screen.getAllByRole('button', { name: /^save trade$/i })[0]!)
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: /^discard$/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    unmount()
    expect(a.discard).not.toHaveBeenCalled()
  })

  it('deletes the uploaded document when nothing was saved', async () => {
    const user = userEvent.setup()
    const { a, onClose, unmount } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
    )
    await screen.findByText(/1 trade was extracted/i)

    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    unmount()

    expect(a.discard).toHaveBeenCalledWith('h1/d1/note.pdf')
  })

  it('warns about a draft that repeats an existing trade', async () => {
    const existing = {
      id: 't1',
      member_id: 'm1',
      ticker: 'VAS',
      traded_on: '2026-07-06',
      units: 10.5,
      price_per_unit_cents: 98_50,
    } as TradeRow
    renderImport(actions(), { trades: [existing] })

    expect(await screen.findByText(/already have a trade with this ticker/i)).toBeInTheDocument()
  })

  it('states why a document could not be read and closes on request', async () => {
    const user = userEvent.setup()
    const a = actions({
      extract: vi.fn().mockResolvedValue({ status: 'failed', message: 'Not a contract note.' }),
    })
    const { onClose } = renderImport(a)

    expect(await screen.findByText('Not a contract note.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('reports an upload failure without reading the document', async () => {
    const a = actions({ upload: vi.fn().mockRejectedValue(new Error('storage')) })
    renderImport(a)

    expect(await screen.findByText(/could not upload this document/i)).toBeInTheDocument()
    expect(a.extract).not.toHaveBeenCalled()
  })

  it('deletes an upload that lands after the panel has closed', async () => {
    let finish: (path: string) => void = () => {}
    const a = actions({ upload: vi.fn(() => new Promise<string>((resolve) => (finish = resolve))) })
    const { unmount } = renderImport(a)

    await waitFor(() => expect(a.upload).toHaveBeenCalled())
    unmount()
    finish('h1/d1/late.pdf')

    await waitFor(() => expect(a.discard).toHaveBeenCalledWith('h1/d1/late.pdf'))
    expect(a.extract).not.toHaveBeenCalled()
  })

  it('ignores a read that finishes after the panel has closed', async () => {
    let finish: (outcome: unknown) => void = () => {}
    const a = actions({ extract: vi.fn(() => new Promise((resolve) => (finish = resolve))) })
    const { unmount } = renderImport(a)
    await waitFor(() => expect(a.extract).toHaveBeenCalled())

    unmount()
    finish({ status: 'read', trades: [buy] })

    await waitFor(() => expect(a.discard).toHaveBeenCalledWith('h1/d1/note.pdf'))
  })

  it('does not report an upload failure after the panel has closed', async () => {
    let fail: (error: Error) => void = () => {}
    const a = actions({ upload: vi.fn(() => new Promise<string>((_, reject) => (fail = reject))) })
    const { unmount } = renderImport(a)

    await waitFor(() => expect(a.upload).toHaveBeenCalled())
    unmount()
    fail(new Error('storage'))

    await waitFor(() => expect(a.extract).not.toHaveBeenCalled())
  })

  it('uploads nothing when the panel closes before the file is ready', async () => {
    const a = actions()
    const { unmount } = renderImport(a)

    unmount()

    await waitFor(() => expect(a.upload).not.toHaveBeenCalled())
  })

  it('refuses a file over the size limit without uploading it', async () => {
    const big = new File(['x'], 'big.pdf')
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    const a = actions()
    render(
      <TradeDocumentImport file={big} member={will} trades={[]} actions={a} onClose={vi.fn()} />,
    )

    expect(await screen.findByText(FILE_TOO_LARGE_MESSAGE)).toBeInTheDocument()
    expect(a.upload).not.toHaveBeenCalled()
  })

  it('attaches a document the model cannot read and offers a blank trade to fill in', async () => {
    const a = actions()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <TradeDocumentImport
        file={new File(['x'], 'contract.docx')}
        member={will}
        trades={[]}
        actions={a}
        onClose={onClose}
      />,
    )

    expect(await screen.findByText(/can't be read automatically/i)).toBeInTheDocument()
    expect(a.extract).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/^ticker$/i) as HTMLInputElement).value).toBe('')

    await user.click(screen.getByRole('button', { name: /discard/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('offers a blank trade when the function reports the type unreadable', async () => {
    const a = actions({
      extract: vi.fn().mockResolvedValue({ status: 'unsupported', message: 'Not readable.' }),
    })
    renderImport(a)

    expect(await screen.findByText('Not readable.')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(1)
  })
})
