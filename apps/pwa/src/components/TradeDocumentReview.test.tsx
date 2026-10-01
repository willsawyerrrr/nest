import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TradeRow } from '../hooks/useTrades'
import { useTradeUploadQueue, type TradeDocumentActions } from '../hooks/useTradeUploadQueue'
import { MAX_BATCH_FILES } from '../lib/bulkUpload'
import { FILE_TOO_LARGE_MESSAGE, MAX_UPLOAD_BYTES } from '../lib/uploadFile'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { TradeDocumentReview } from './TradeDocumentDrafts'

const will = makeMember({ id: 'm1', name: 'Will' })
const PICKER = 'Contract notes'

function pdf(name: string) {
  return new File(['x'], name, { type: 'application/pdf' })
}

const buy = {
  values: {
    ticker: 'VAS',
    side: 'buy' as const,
    traded_on: '2026-07-06',
    units: 10.5,
    price_per_unit_microdollars: 98_500_000,
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
    upload: vi.fn(async (id: string, file: File) => `h1/${id}/${file.name}`),
    discard: vi.fn().mockResolvedValue(undefined),
    extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy, sell] }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** Stands in for the Add trade card's file input, which feeds the queue. */
function Harness({ trades, actions: a }: { trades: TradeRow[]; actions: TradeDocumentActions }) {
  const queue = useTradeUploadQueue(a)
  return (
    <>
      <input
        type="file"
        multiple
        aria-label={PICKER}
        onChange={(event) => queue.add([...(event.currentTarget.files ?? [])], undefined)}
      />
      <TradeDocumentReview queue={queue} member={will} trades={trades} actions={a} />
    </>
  )
}

function renderImport(a = actions(), trades: TradeRow[] = []) {
  const view = render(<Harness trades={trades} actions={a} />)
  return { ...view, a, user: userEvent.setup() }
}

async function pick(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
  await user.upload(screen.getByLabelText(PICKER), files)
}

function card(name: string) {
  return screen.getByRole('generic', { name })
}

describe('TradeDocumentImport', () => {
  it('reads each document into its own set of trade drafts with a status per file', async () => {
    const { a, user } = renderImport()
    await pick(user, pdf('one.pdf'), pdf('two.pdf'))

    await waitFor(() =>
      expect(within(card('one.pdf')).getAllByLabelText(/^ticker$/i)).toHaveLength(2),
    )
    expect(within(card('two.pdf')).getAllByLabelText(/^ticker$/i)).toHaveLength(2)
    expect(within(card('one.pdf')).getByText('Ready')).toBeInTheDocument()
    expect(within(card('one.pdf')).getByText(/2 trades were extracted by AI/i)).toBeInTheDocument()
    expect(within(card('one.pdf')).getByText(/check the price per unit/i)).toBeInTheDocument()
    expect(a.extract).toHaveBeenCalledTimes(2)
    expect(a.upload).toHaveBeenCalledWith(expect.any(String), expect.any(File))
  })

  it('says when a single trade was read', async () => {
    const { user } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
    )
    await pick(user, pdf('one.pdf'))
    expect(await screen.findByText(/1 trade was extracted by AI/i)).toBeInTheDocument()
  })

  it('names several fields to check', async () => {
    const { user } = renderImport(
      actions({
        extract: vi.fn().mockResolvedValue({
          status: 'read',
          trades: [{ values: {}, check: ['date', 'units'] }],
        }),
      }),
    )
    await pick(user, pdf('one.pdf'))
    expect(await screen.findByText(/check the date, units/i)).toBeInTheDocument()
    expect(screen.getByText(/did not give them clearly/i)).toBeInTheDocument()
  })

  it('shows a file as queued, then reading, while earlier ones are read', async () => {
    const finish: ((outcome: unknown) => void)[] = []
    const a = actions({ extract: vi.fn(() => new Promise((resolve) => finish.push(resolve))) })
    const { user } = renderImport(a)
    await pick(user, pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf'))

    await waitFor(() => expect(a.extract).toHaveBeenCalledTimes(3))
    expect(within(card('d.pdf')).getByText('Queued')).toBeInTheDocument()
    expect(within(card('a.pdf')).getByText('Reading')).toBeInTheDocument()

    finish[0]!({ status: 'read', trades: [buy] })
    await waitFor(() => expect(a.extract).toHaveBeenCalledTimes(4))
  })

  it('saves a confirmed draft against its own document and keeps the rest', async () => {
    const { a, user } = renderImport()
    await pick(user, pdf('one.pdf'))
    await screen.findByText(/2 trades were extracted/i)

    await user.click(screen.getAllByRole('button', { name: /^save trade$/i })[0]!)

    await waitFor(() =>
      expect(a.save).toHaveBeenCalledWith({
        documentId: expect.any(String),
        path: expect.stringMatching(/one\.pdf$/),
        id: expect.any(String),
        input: {
          member_id: 'm1',
          ticker: 'VAS',
          side: 'buy',
          traded_on: '2026-07-06',
          units: 10.5,
          price_per_unit_microdollars: 98_500_000,
          fee_cents: 9_50,
        },
      }),
    )
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(1))
    expect(screen.getByLabelText(/^ticker$/i)).toHaveValue('VGS')
  })

  it('marks a document saved once its last draft is saved or discarded, and keeps its file', async () => {
    const { a, user, unmount } = renderImport()
    await pick(user, pdf('one.pdf'))
    await screen.findByText(/2 trades were extracted/i)

    await user.click(screen.getAllByRole('button', { name: /^save trade$/i })[0]!)
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: /^discard$/i }))

    expect(await within(card('one.pdf')).findByText('Saved')).toBeInTheDocument()
    unmount()
    expect(a.discard).not.toHaveBeenCalled()
  })

  it('removes a document and deletes its file when every draft is discarded', async () => {
    const { a, user } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
    )
    await pick(user, pdf('one.pdf'))
    await screen.findByText(/1 trade was extracted/i)

    await user.click(screen.getByRole('button', { name: /^discard$/i }))

    await waitFor(() => expect(screen.queryByLabelText('one.pdf')).not.toBeInTheDocument())
    expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/one\.pdf$/))
  })

  it('warns about a draft that repeats an existing trade', async () => {
    const existing = {
      id: 't1',
      member_id: 'm1',
      ticker: 'VAS',
      traded_on: '2026-07-06',
      units: 10.5,
      price_per_unit_microdollars: 98_500_000,
    } as TradeRow
    const { user } = renderImport(actions(), [existing])
    await pick(user, pdf('one.pdf'))

    expect(await screen.findByText(/already have a trade with this ticker/i)).toBeInTheDocument()
  })

  it('lets one unreadable document fail without blocking the others', async () => {
    const extract = vi.fn(async (path: string) =>
      path.endsWith('bad.pdf')
        ? { status: 'failed', message: 'Not a contract note.' }
        : { status: 'read', trades: [buy] },
    )
    const { user } = renderImport(actions({ extract }))
    await pick(user, pdf('bad.pdf'), pdf('good.pdf'))

    expect(await within(card('bad.pdf')).findByText("Couldn't be read")).toBeInTheDocument()
    expect(within(card('bad.pdf')).getByText('Not a contract note.')).toBeInTheDocument()
    expect(await within(card('good.pdf')).findByText(/1 trade was extracted/i)).toBeInTheDocument()
  })

  it('retries a failed document without storing it again', async () => {
    const extract = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', message: 'Try later.' })
      .mockResolvedValue({ status: 'read', trades: [buy] })
    const { a, user } = renderImport(actions({ extract }))
    await pick(user, pdf('one.pdf'))

    await user.click(await screen.findByRole('button', { name: /try one\.pdf again/i }))

    expect(await screen.findByText(/1 trade was extracted/i)).toBeInTheDocument()
    expect(a.upload).toHaveBeenCalledTimes(1)
  })

  it('offers a blank trade for a document that failed, to fill in by hand', async () => {
    const { user } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'failed', message: 'Busy.' }) }),
    )
    await pick(user, pdf('one.pdf'))

    await user.click(await screen.findByRole('button', { name: /enter one\.pdf by hand/i }))

    expect(within(card('one.pdf')).getByText('Enter by hand')).toBeInTheDocument()
    expect((screen.getByLabelText(/^ticker$/i) as HTMLInputElement).value).toBe('')
  })

  it('reports an upload failure without reading the document, and offers no hand entry', async () => {
    const a = actions({ upload: vi.fn().mockRejectedValue(new Error('storage')) })
    const { user } = renderImport(a)
    await pick(user, pdf('one.pdf'))

    expect(await screen.findByText(/could not upload this file/i)).toBeInTheDocument()
    expect(a.extract).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /by hand/i })).not.toBeInTheDocument()
  })

  it('refuses a file over the size limit without uploading it or offering a retry', async () => {
    const big = new File(['x'], 'big.pdf')
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    const { a, user } = renderImport()
    await pick(user, big)

    expect(await screen.findByText(FILE_TOO_LARGE_MESSAGE)).toBeInTheDocument()
    expect(a.upload).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /again/i })).not.toBeInTheDocument()
  })

  it('attaches a document the model cannot read and offers a blank trade to fill in', async () => {
    const { a, user } = renderImport()
    await pick(user, new File(['x'], 'contract.docx'))

    expect(await screen.findByText(/can't be read automatically/i)).toBeInTheDocument()
    expect(within(card('contract.docx')).getByText('Unsupported type')).toBeInTheDocument()
    expect(a.extract).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/^ticker$/i) as HTMLInputElement).value).toBe('')
  })

  it('offers a blank trade when the function reports the type unreadable', async () => {
    const { user } = renderImport(
      actions({
        extract: vi.fn().mockResolvedValue({ status: 'unsupported', message: 'Not readable.' }),
      }),
    )
    await pick(user, pdf('one.pdf'))

    expect(await screen.findByText('Not readable.')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(1)
  })

  it('stops reading when reading is off, and says so once', async () => {
    const a = actions({
      extract: vi.fn().mockResolvedValue({ status: 'off', message: 'Reading is off.' }),
    })
    const { user } = renderImport(a)
    await pick(user, ...['a', 'b', 'c', 'd', 'e'].map((n) => pdf(`${n}.pdf`)))

    expect(await screen.findByText('Reading has stopped')).toBeInTheDocument()
    expect(a.extract.mock.calls.length).toBeLessThanOrEqual(3)
    expect(screen.getAllByText("Couldn't be read")).toHaveLength(5)
  })

  it('leaves out files beyond the batch limit and says how many', async () => {
    const { user } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'failed', message: 'Busy.' }) }),
    )
    await pick(user, ...Array.from({ length: MAX_BATCH_FILES + 2 }, (_, i) => pdf(`f${i}.pdf`)))

    expect(await screen.findByText(/2 files were left out/i)).toBeInTheDocument()
  })

  describe('saving several drafts', () => {
    it('saves every selected draft, with progress and a summary', async () => {
      const { a, user } = renderImport()
      await pick(user, pdf('one.pdf'), pdf('two.pdf'))
      await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(4))
      // The second trade of each lacks a price, so is not valid to save yet.
      for (const price of screen.getAllByLabelText(/price per unit/i).slice(1)) {
        await user.type(price, '10')
      }

      await user.click(screen.getByRole('button', { name: /save selected \(2\)/i }))

      expect(await screen.findByText(/^Saved 4\./)).toBeInTheDocument()
      expect(a.save).toHaveBeenCalledTimes(4)
      expect(within(card('one.pdf')).getByText('Saved')).toBeInTheDocument()
      expect(within(card('two.pdf')).getByText('Saved')).toBeInTheDocument()
    })

    it('reports a draft that is not valid yet without saving it, and keeps going', async () => {
      const { a, user } = renderImport()
      await pick(user, pdf('one.pdf'), pdf('two.pdf'))
      await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(4))

      await user.click(screen.getByRole('button', { name: /save selected/i }))

      // The sells lack a price, so each document saves its buy and needs a look.
      expect(await screen.findByText(/Saved 2\. 2 files need another look/i)).toBeInTheDocument()
      expect(a.save).toHaveBeenCalledTimes(2)
      expect(screen.getAllByText('This one still needs a look.')).toHaveLength(2)
    })

    it('reports a save that fails and keeps the draft to try again', async () => {
      const save = vi.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValue(undefined)
      const { user } = renderImport(
        actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }), save }),
      )
      await pick(user, pdf('one.pdf'))
      await screen.findByText(/1 trade was extracted/i)

      await user.click(screen.getByRole('button', { name: /save selected/i }))
      expect(await screen.findByText(/Saved 0\. 1 file needs another look/i)).toBeInTheDocument()
      expect(screen.getByText(/could not save this trade/i)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /save selected/i }))
      expect(await screen.findByText(/^Saved 1\./)).toBeInTheDocument()
      // The retried save is written under the same ids, so it cannot duplicate.
      expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0])
    })

    it('saves only the selected drafts, and selects them all again on request', async () => {
      const { a, user } = renderImport(
        actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
      )
      await pick(user, pdf('one.pdf'), pdf('two.pdf'))
      await screen.findAllByLabelText(/^ticker$/i)
      await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(2))

      await user.click(screen.getByLabelText('Select two.pdf'))
      expect(screen.getByRole('button', { name: /save selected \(1\)/i })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /save selected \(1\)/i }))
      await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1))
      expect(a.save.mock.calls[0]![0].path).toMatch(/one\.pdf$/)
    })

    it('selects and clears every draft from Select all', async () => {
      const { user } = renderImport(
        actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
      )
      await pick(user, pdf('one.pdf'), pdf('two.pdf'))
      await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(2))

      await user.click(screen.getByLabelText('Select all'))
      expect(screen.getByRole('button', { name: /save selected \(0\)/i })).toBeDisabled()
      await user.click(screen.getByLabelText('Select two.pdf'))
      expect(screen.getByRole('button', { name: /save selected \(1\)/i })).toBeEnabled()
      await user.click(screen.getByLabelText('Select all'))
      expect(screen.getByRole('button', { name: /save selected \(2\)/i })).toBeEnabled()
    })
  })

  it('deletes the stored files of unsaved drafts on Discard all, and clears saved ones on Done', async () => {
    const { a, user } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
    )
    await pick(user, pdf('one.pdf'), pdf('two.pdf'))
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(2))

    await user.click(within(card('one.pdf')).getByRole('button', { name: /^save trade$/i }))
    await within(card('one.pdf')).findByText('Saved')

    await user.click(screen.getByRole('button', { name: /discard all/i }))
    expect(screen.queryByLabelText('one.pdf')).not.toBeInTheDocument()
    expect(a.discard).toHaveBeenCalledTimes(1)
    expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/two\.pdf$/))
  })

  it('offers Done once everything is saved', async () => {
    const { user } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
    )
    await pick(user, pdf('one.pdf'))
    await user.click(await screen.findByRole('button', { name: /^save trade$/i }))
    await user.click(await screen.findByRole('button', { name: /^done$/i }))
    expect(screen.queryByLabelText('one.pdf')).not.toBeInTheDocument()
  })

  it('deletes unsaved documents when the panel closes', async () => {
    const { a, user, unmount } = renderImport(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }) }),
    )
    await pick(user, pdf('one.pdf'))
    await screen.findByText(/1 trade was extracted/i)

    unmount()
    expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/one\.pdf$/))
  })
})
