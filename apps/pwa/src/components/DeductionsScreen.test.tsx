import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function renderScreen(overrides: Partial<Parameters<typeof DeductionsScreen>[0]> = {}) {
  const props = {
    members: [will, sam],
    deductions: [makeDeduction()],
    receipts: [] as DeductionReceiptRow[],
    financialYear: 2027,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onUploadReceipt: vi.fn().mockResolvedValue(undefined),
    onRemoveReceipt: vi.fn().mockResolvedValue(undefined),
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

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('d1', expect.objectContaining({})))
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
        expect.objectContaining({ description: 'Union fees', amount_cents: 50000 }),
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
