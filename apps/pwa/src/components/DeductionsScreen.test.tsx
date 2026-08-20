import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionRow } from '../hooks/useDeductions'
import { makeMember } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { DeductionsScreen } from './DeductionsScreen'

const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

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
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeReceipt(overrides: Partial<DeductionReceiptRow> = {}): DeductionReceiptRow {
  return {
    id: 'r1',
    deduction_id: 'd1',
    household_id: 'h1',
    storage_path: 'h1/d1/abc-receipt.pdf',
    file_name: 'receipt.pdf',
    created_at: '',
    ...overrides,
  }
}

const attachments: DeductionAttachments = {
  upload: vi
    .fn()
    .mockResolvedValue({ storage_path: 'h1/new/uuid-receipt.pdf', file_name: 'receipt.pdf' }),
  discard: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue({ status: 'read', extraction: { model: 'x', fields: {} } }),
}

function renderScreen(overrides: Partial<Parameters<typeof DeductionsScreen>[0]> = {}) {
  const props = {
    members: [will, sam],
    deductions: [makeDeduction()],
    receipts: [] as DeductionReceiptRow[],
    financialYear: 2027,
    attachments,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onUploadReceipt: vi.fn().mockResolvedValue(undefined),
    onRemoveReceipt: vi.fn().mockResolvedValue(undefined),
    onRenameReceipt: vi.fn().mockResolvedValue(undefined),
    signedUrl: vi.fn().mockResolvedValue('https://signed/url'),
    ...overrides,
  }
  render(<DeductionsScreen {...props} />)
  return props
}

afterEach(() => vi.restoreAllMocks())

describe('DeductionsScreen', () => {
  it('shows an empty hint per member without deductions', () => {
    renderScreen({ deductions: [] })
    expect(screen.getAllByText(/no deductions yet/i)).toHaveLength(2)
  })

  it('renders a deduction with its amount and date', () => {
    renderScreen()
    const card = screen.getByText('Home office').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('$1,200.00')).toBeInTheDocument()
    expect(within(card).getByText(/1 Aug 2026/)).toBeInTheDocument()
  })

  it('renders the claimed distance beside the date of a distance-basis deduction', () => {
    renderScreen({
      deductions: [
        makeDeduction({ description: 'Client visits', basis: 'distance', distance_km: 120 }),
      ],
    })
    const card = screen.getByText('Client visits').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText(/1 Aug 2026 · 120km/)).toBeInTheDocument()
  })

  it('shows a per-member deductions total', () => {
    renderScreen({ members: [will], deductions: [makeDeduction(), makeDeduction({ id: 'd2' })] })
    // Two $1,200 deductions plus the $2,400 total.
    expect(screen.getByText('$2,400.00')).toBeInTheDocument()
  })

  it('edits a deduction in place and saves the change', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen()

    const card = screen.getByText('Home office').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      // Editing goes through a plain field update, not the receipts-replacing
      // RPC, so it carries the deduction's own fields — never a submission
      // shape with an `input`/`receipts` split.
      expect(onUpdate).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ description: 'Home office' }),
      ),
    )
  })

  it('confirms before deleting a deduction', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderScreen()

    const card = screen.getByText('Home office').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('d1')
  })

  it('adds a new deduction', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderScreen({ members: [will], deductions: [] })

    await user.click(screen.getByRole('button', { name: /add deduction/i }))
    await user.type(screen.getByLabelText(/description/i), 'Union fees')
    await user.type(screen.getByLabelText(/amount/i), '500')
    await user.click(screen.getByRole('button', { name: /^add deduction$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ description: 'Union fees', amount_cents: 50000 }),
          receipts: [],
        }),
      ),
    )
  })

  it('uploads a receipt for a deduction', async () => {
    const user = userEvent.setup()
    const { onUploadReceipt } = renderScreen()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    await user.upload(input, file)

    expect(onUploadReceipt).toHaveBeenCalledWith('d1', file)
  })

  it('opens a stored receipt in a new tab via its signed URL', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { signedUrl } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: 'receipt.pdf' }))

    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith('h1/d1/abc-receipt.pdf'))
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://signed/url', '_blank', 'noopener'),
    )
  })

  it('does not open a tab when the signed URL cannot be created', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderScreen({ receipts: [makeReceipt()], signedUrl: vi.fn().mockResolvedValue(null) })

    await user.click(screen.getByRole('button', { name: 'receipt.pdf' }))

    await waitFor(() => expect(open).not.toHaveBeenCalled())
  })

  it('confirms before deleting a receipt', async () => {
    const user = userEvent.setup()
    const { onRemoveReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /delete receipt receipt\.pdf/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onRemoveReceipt).toHaveBeenCalledWith(makeReceipt())
  })

  it('renames a receipt in place', async () => {
    const user = userEvent.setup()
    const { onRenameReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /rename receipt\.pdf/i }))
    const input = screen.getByRole('textbox', { name: /rename receipt\.pdf/i })
    await user.clear(input)
    await user.type(input, 'Officeworks invoice.pdf')
    await user.click(screen.getByRole('button', { name: /save name for receipt\.pdf/i }))

    expect(onRenameReceipt).toHaveBeenCalledWith(makeReceipt(), 'Officeworks invoice.pdf')
    // The edit control closes once saved.
    expect(screen.queryByRole('textbox', { name: /rename receipt\.pdf/i })).not.toBeInTheDocument()
  })

  it('blocks saving a receipt name that is blank', async () => {
    const user = userEvent.setup()
    const { onRenameReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /rename receipt\.pdf/i }))
    const input = screen.getByRole('textbox', { name: /rename receipt\.pdf/i })
    await user.clear(input)
    await user.type(input, '   ')

    expect(screen.getByRole('button', { name: /save name for receipt\.pdf/i })).toBeDisabled()
    // Enter bypasses the disabled button, so the guard inside save() is what
    // actually stops a blank name — not just the disabled control.
    await user.type(input, '{Enter}')
    expect(onRenameReceipt).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /rename receipt\.pdf/i })).toBeInTheDocument()
  })

  it('saves a receipt rename on Enter', async () => {
    const user = userEvent.setup()
    const { onRenameReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /rename receipt\.pdf/i }))
    const input = screen.getByRole('textbox', { name: /rename receipt\.pdf/i })
    await user.clear(input)
    await user.type(input, 'Officeworks invoice.pdf{Enter}')

    expect(onRenameReceipt).toHaveBeenCalledWith(makeReceipt(), 'Officeworks invoice.pdf')
    expect(screen.queryByRole('textbox', { name: /rename receipt\.pdf/i })).not.toBeInTheDocument()
  })

  it('cancels a receipt rename on Escape', async () => {
    const user = userEvent.setup()
    const { onRenameReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /rename receipt\.pdf/i }))
    const input = screen.getByRole('textbox', { name: /rename receipt\.pdf/i })
    await user.type(input, 'Something else{Escape}')

    expect(onRenameReceipt).not.toHaveBeenCalled()
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument()
  })

  it('cancels a receipt rename without saving', async () => {
    const user = userEvent.setup()
    const { onRenameReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /rename receipt\.pdf/i }))
    await user.type(screen.getByRole('textbox', { name: /rename receipt\.pdf/i }), 'Something else')
    await user.click(screen.getByRole('button', { name: /cancel renaming receipt\.pdf/i }))

    expect(onRenameReceipt).not.toHaveBeenCalled()
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument()
  })

  describe('on desktop', () => {
    it('renders each deduction as a dense row with its receipts on the caption line', () => {
      setWideViewport()
      renderScreen({ members: [will], receipts: [makeReceipt()] })

      // No bordered card wraps a row.
      expect(screen.getByText('Home office').closest('.mantine-Card-root')).toBeNull()
      // The row amount plus the per-member total, both $1,200.00.
      expect(screen.getAllByText('$1,200.00')).toHaveLength(2)
      expect(screen.getByText(/1 Aug 2026/)).toBeInTheDocument()
      // The receipt and its upload control still show beneath the row.
      expect(screen.getByRole('button', { name: 'receipt.pdf' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })
  })
})
