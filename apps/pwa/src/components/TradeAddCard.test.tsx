import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FILE_TOO_LARGE_MESSAGE, MAX_UPLOAD_BYTES } from '../lib/uploadFile'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { TradeAddCard } from './TradeAddCard'

const will = makeMember({ id: 'm1', name: 'Will' })

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
    extract: vi.fn().mockResolvedValue({ status: 'read', trades: [buy] }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function setup(a = actions()) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onCancel = vi.fn()
  const view = render(
    <TradeAddCard member={will} trades={[]} actions={a} onSubmit={onSubmit} onCancel={onCancel} />,
  )
  return { ...view, a, onSubmit, onCancel, user: userEvent.setup() }
}

function filePicker() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

async function attach(user: ReturnType<typeof userEvent.setup>, name = 'note.pdf') {
  await user.upload(filePicker(), new File(['x'], name, { type: 'application/pdf' }))
}

describe('TradeAddCard', () => {
  it('adds a trade by hand without a document', async () => {
    const { a, onSubmit, user } = setup()
    await user.type(screen.getByLabelText(/^ticker$/i), 'vas')
    await user.type(screen.getByLabelText(/^units$/i), '2')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'VAS' })),
    )
    expect(a.save).not.toHaveBeenCalled()
  })

  it('fills the form from a contract note and saves the trade with the document', async () => {
    const { a, onSubmit, onCancel, user } = setup()
    await attach(user)

    expect(await screen.findByText(/extracted from the contract note by AI/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^ticker$/i)).toHaveValue('VAS')
    expect(screen.getByLabelText(/^units$/i)).toHaveValue('10.5')
    expect(screen.getByText('Contract note attached')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^add trade$/i }))
    await waitFor(() =>
      expect(a.save).toHaveBeenCalledWith({
        documentId: expect.any(String),
        path: expect.stringMatching(/note\.pdf$/),
        id: expect.any(String),
        input: expect.objectContaining({ member_id: 'm1', ticker: 'VAS', units: 10.5 }),
      }),
    )
    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(a.discard).not.toHaveBeenCalled()
  })

  it('names the fields to check', async () => {
    const { user } = setup(
      actions({
        extract: vi.fn().mockResolvedValue({
          status: 'read',
          trades: [{ values: { ticker: 'VAS' }, check: ['date'] }],
        }),
      }),
    )
    await attach(user)
    expect(await screen.findByText(/check the date/i)).toBeInTheDocument()
  })

  it.each([
    ['no values', [{ values: {}, check: [] }]],
    ['no trades', []],
  ])('says nothing could be filled in when the read gave %s', async (_label, trades) => {
    const { user } = setup(
      actions({ extract: vi.fn().mockResolvedValue({ status: 'read', trades }) }),
    )
    await attach(user)
    expect(
      await screen.findByText(/nothing on the contract note could be filled in/i),
    ).toBeInTheDocument()
  })

  it('disables saving while the document is stored and read', async () => {
    let finish: (outcome: unknown) => void = () => {}
    const { user } = setup(
      actions({ extract: vi.fn(() => new Promise((resolve) => (finish = resolve))) }),
    )
    await user.type(screen.getByLabelText(/^ticker$/i), 'vas')
    await user.type(screen.getByLabelText(/^units$/i), '2')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await attach(user)

    expect(await screen.findByText('Reading the contract note…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add trade$/i })).toBeDisabled()
    finish({ status: 'read', trades: [buy] })
    await waitFor(() => expect(screen.getByRole('button', { name: /^add trade$/i })).toBeEnabled())
  })

  it('shows storing while the upload is in flight', async () => {
    const { user } = setup(actions({ upload: vi.fn(() => new Promise<string>(() => {})) }))
    await attach(user)
    expect(await screen.findByText('Storing the contract note…')).toBeInTheDocument()
  })

  it('keeps an unreadable type attached for hand entry', async () => {
    const { a, user } = setup()
    await user.upload(filePicker(), new File(['x'], 'note.zip', { type: 'application/zip' }))

    expect(await screen.findByText(/can't be read automatically/i)).toBeInTheDocument()
    expect(a.extract).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/^ticker$/i), 'vas')
    await user.type(screen.getByLabelText(/^units$/i), '2')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))
    await waitFor(() =>
      expect(a.save).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/note\.zip$/) }),
      ),
    )
  })

  it('shows a failed read as a warning and keeps the document attached', async () => {
    const { user } = setup(
      actions({
        extract: vi.fn().mockResolvedValue({ status: 'failed', message: 'Not a contract note.' }),
      }),
    )
    await attach(user)
    expect(await screen.findByText('Not a contract note.')).toBeInTheDocument()
    expect(screen.getByText('Contract note attached')).toBeInTheDocument()
  })

  it('states why reading is off without a warning', async () => {
    const { user } = setup(
      actions({
        extract: vi.fn().mockResolvedValue({ status: 'off', message: 'Reading is out of credit.' }),
      }),
    )
    await attach(user)
    expect(await screen.findByText('Reading is out of credit.')).toBeInTheDocument()
  })

  it('reports a document that is too large and attaches nothing', async () => {
    const { a, user } = setup()
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    await user.upload(filePicker(), big)

    expect(await screen.findByText(FILE_TOO_LARGE_MESSAGE)).toBeInTheDocument()
    expect(a.upload).not.toHaveBeenCalled()
    expect(screen.queryByText('Contract note attached')).not.toBeInTheDocument()
  })

  it('deletes a removed document and adds the trade without it', async () => {
    const { a, onSubmit, user } = setup()
    await attach(user)
    await screen.findByText('Contract note attached')

    await user.click(screen.getByRole('button', { name: /remove contract note/i }))
    expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/note\.pdf$/))
    expect(screen.queryByText('Contract note attached')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/^ticker$/i), 'vas')
    await user.type(screen.getByLabelText(/^units$/i), '2')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  it('replaces the document when another is picked', async () => {
    const { a, user } = setup()
    await attach(user, 'one.pdf')
    await screen.findByText('Contract note attached')
    await attach(user, 'two.pdf')

    await waitFor(() => expect(a.upload).toHaveBeenCalledTimes(2))
    expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/one\.pdf$/))
  })

  it('deletes an unsaved document when the card is left', async () => {
    const { a, user, unmount } = setup()
    await attach(user)
    await screen.findByText('Contract note attached')
    unmount()
    expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/note\.pdf$/))
  })

  describe('several trades or files', () => {
    const several = () =>
      actions({
        extract: vi.fn().mockResolvedValue({
          status: 'read',
          trades: [
            buy,
            { ...sell, values: { ...sell.values, price_per_unit_microdollars: 5_000_000 } },
          ],
        }),
      })

    it('opens each trade of one document as a draft in place of the form', async () => {
      const { a, user } = setup(several())
      await attach(user)
      expect(await screen.findByText(/2 trades were extracted by AI/i)).toBeInTheDocument()
      expect(screen.queryByLabelText('Contract note')).not.toBeInTheDocument()

      await user.click(screen.getAllByRole('button', { name: /^save trade$/i })[0]!)
      await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1))
      await user.click(screen.getByRole('button', { name: /^save trade$/i }))
      await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2))
      expect(a.save.mock.calls[0]![0].documentId).toBe(a.save.mock.calls[1]![0].documentId)
      expect(a.discard).not.toHaveBeenCalled()
    })

    it('reviews several picked files together', async () => {
      const { a, user } = setup()
      await user.upload(filePicker(), [
        new File(['x'], 'one.pdf', { type: 'application/pdf' }),
        new File(['x'], 'two.pdf', { type: 'application/pdf' }),
      ])

      await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/i)).toHaveLength(2))
      expect(a.extract).toHaveBeenCalledTimes(2)
      expect(screen.getByLabelText("Add Will's trades from contract notes")).toBeInTheDocument()
    })

    it('returns to the blank form and deletes the document when every draft is discarded', async () => {
      const { a, onCancel, user } = setup(several())
      await attach(user)
      await screen.findByText(/2 trades were extracted/i)

      await user.click(screen.getAllByRole('button', { name: /^discard$/i })[0]!)
      await user.click(screen.getByRole('button', { name: /^discard$/i }))

      expect(await screen.findByLabelText(/^ticker$/i)).toHaveValue('')
      expect(a.discard).toHaveBeenCalledWith(expect.stringMatching(/note\.pdf$/))
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('can be closed', async () => {
      const { onCancel, user } = setup(several())
      await attach(user)
      await screen.findByText(/2 trades were extracted/i)
      await user.click(screen.getByRole('button', { name: /^close$/i }))
      expect(onCancel).toHaveBeenCalled()
    })
  })
})
