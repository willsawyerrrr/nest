import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionRow } from '../hooks/useDeductions'
import { makeMember } from '../test/fixtures'
import { act, render, screen, setWideViewport, waitFor, within } from '../test/render'
import { DeductionsScreen } from './DeductionsScreen'

const dnd = vi.hoisted(() => ({
  onDragStart: undefined as ((event: unknown) => void) | undefined,
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
  onDragCancel: undefined as (() => void) | undefined,
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart,
      onDragEnd,
      onDragCancel,
    }: {
      children: React.ReactNode
      onDragStart?: (event: unknown) => void
      onDragEnd?: (event: unknown) => void
      onDragCancel?: () => void
    }) => {
      dnd.onDragStart = onDragStart
      dnd.onDragEnd = onDragEnd
      dnd.onDragCancel = onDragCancel
      return children
    },
  }
})

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
    work_from_home_hours: null,
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

function makeReceipt(overrides: Partial<DeductionReceiptRow> = {}): DeductionReceiptRow {
  return {
    id: 'r1',
    deduction_id: 'd1',
    household_id: 'h1',
    storage_path: 'h1/d1/abc-receipt.pdf',
    created_at: '',
    ...overrides,
  }
}

const attachments: DeductionAttachments = {
  upload: vi.fn().mockResolvedValue('h1/new/uuid-receipt.pdf'),
  discard: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue({ status: 'read', extraction: { model: 'x', fields: {} } }),
}

function renderScreen(overrides: Partial<Parameters<typeof DeductionsScreen>[0]> = {}) {
  const props = {
    members: [will, sam],
    deductions: [makeDeduction()],
    groups: [] as DeductionGroupRow[],
    receipts: [] as DeductionReceiptRow[],
    financialYear: 2027,
    availableFinancialYears: [2027, 2026],
    onFinancialYearChange: vi.fn(),
    attachments,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onCreateGroup: vi.fn().mockResolvedValue(undefined),
    onUpdateGroup: vi.fn().mockResolvedValue(undefined),
    onDeleteGroup: vi.fn().mockResolvedValue(undefined),
    onUploadReceipt: vi.fn().mockResolvedValue(undefined),
    onRemoveReceipt: vi.fn().mockResolvedValue(undefined),
    signedUrl: vi.fn().mockResolvedValue('https://signed/url'),
    ...overrides,
  }
  render(<DeductionsScreen {...props} />)
  return props
}

/** The form's group picker; its label also labels Mantine's listbox. */
function groupPicker() {
  return screen.getByRole('combobox', { name: 'Group' })
}

afterEach(() => {
  vi.restoreAllMocks()
  dnd.onDragStart = undefined
  dnd.onDragEnd = undefined
  dnd.onDragCancel = undefined
})

describe('DeductionsScreen', () => {
  it('titles the page with the selected financial year', () => {
    renderScreen({ financialYear: 2027 })
    expect(screen.getByRole('heading', { name: /Tax deductions \(FY2027\)/ })).toBeInTheDocument()
  })

  it('offers every available financial year and reports a change', async () => {
    const onFinancialYearChange = vi.fn()
    const user = userEvent.setup()
    renderScreen({
      financialYear: 2027,
      availableFinancialYears: [2027, 2026],
      onFinancialYearChange,
    })

    await user.click(screen.getByRole('combobox', { name: /financial year/i }))
    await user.click(await screen.findByRole('option', { name: 'FY2026' }))

    expect(onFinancialYearChange).toHaveBeenCalledWith(2026)
  })

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

  it('renders the hours beside the date of an hours-basis deduction', () => {
    renderScreen({
      deductions: [
        makeDeduction({
          description: 'Home office',
          basis: 'hours',
          work_from_home_hours: 40,
        }),
      ],
    })
    const card = screen.getByText('Home office').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText(/1 Aug 2026 · 40 hours/)).toBeInTheDocument()
  })

  it('renders the work-use share beside the date of a part-claimed deduction', () => {
    renderScreen({
      deductions: [
        makeDeduction({
          description: 'Phone plan',
          amount_cents: 60_00,
          full_amount_cents: 100_00,
          work_use_percent: 60,
        }),
      ],
    })
    const card = screen.getByText('Phone plan').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText(/1 Aug 2026 · 60% work use/)).toBeInTheDocument()
  })

  it('shows no work-use share beside a deduction claimed in full', () => {
    renderScreen({ deductions: [makeDeduction({ description: 'Union fees' })] })
    const card = screen.getByText('Union fees').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).queryByText(/work use/)).not.toBeInTheDocument()
  })

  it('gives a donation no drag handle and its group no edit or delete control', () => {
    renderScreen({
      members: [will],
      groups: [makeGroup({ id: 'gd', name: 'Donations', kind: 'donations' })],
      deductions: [
        makeDeduction({ id: 'd1', description: 'Red Cross', category: 'donation', group_id: 'gd' }),
        makeDeduction({ id: 'd2', description: 'Home office' }),
      ],
    })

    expect(
      screen.queryByRole('button', { name: 'Drag Red Cross to a group' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drag Home office to a group' })).toBeInTheDocument()
    const group = screen.getByText('Donations').closest('.mantine-Card-root') as HTMLElement
    expect(within(group).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('reads a group as one row, its payments totalled underneath', async () => {
    const user = userEvent.setup()
    renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [
        makeDeduction({ id: 'd1', description: 'Adobe', amount_cents: 64_99, group_id: 'g1' }),
        makeDeduction({ id: 'd2', description: 'Adobe', amount_cents: 65_01, group_id: 'g1' }),
        makeDeduction({ id: 'd3', description: 'Home office' }),
      ],
    })

    expect(screen.getByText('Adobe Creative Cloud')).toBeInTheDocument()
    expect(screen.getByText('2 payments')).toBeInTheDocument()
    expect(screen.getByText('$130.00')).toBeInTheDocument()

    // The member's total counts grouped and ungrouped alike — grouping is a
    // reading of rows each claimed in its own right.
    expect(screen.getByText('$1,330.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /adobe creative cloud/i }))
    expect(screen.getByRole('button', { name: /add payment/i })).toBeInTheDocument()
  })

  it('files a payment added from a group into that group', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [],
    })

    await user.click(screen.getByRole('button', { name: /adobe creative cloud/i }))
    await user.click(screen.getByRole('button', { name: /add payment/i }))
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))
    await user.type(screen.getByLabelText(/description/i), 'Adobe July')
    await user.type(screen.getByLabelText(/amount/i), '64.99')
    await user.click(screen.getByRole('button', { name: /^add payment$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ description: 'Adobe July', group_id: 'g1' }),
        }),
      ),
    )
  })

  it('leaves an ungrouped deduction out of every group', () => {
    renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [makeDeduction({ description: 'Home office' })],
    })

    expect(screen.getByText('0 payments')).toBeInTheDocument()
    expect(screen.getByText('Home office')).toBeInTheDocument()
  })

  it('adds a group for the member', async () => {
    const user = userEvent.setup()
    const { onCreateGroup } = renderScreen({ members: [will], groups: [], deductions: [] })

    await user.click(screen.getByRole('button', { name: /add group/i }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Xero')
    await user.click(screen.getByRole('button', { name: /^add group$/i }))

    await waitFor(() =>
      expect(onCreateGroup).toHaveBeenCalledWith({ member_id: 'm1', name: 'Xero' }),
    )
  })

  it('confirms before deleting a group, which keeps its payments', async () => {
    const user = userEvent.setup()
    const { onDeleteGroup } = renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [makeDeduction({ group_id: 'g1' })],
    })

    const card = screen
      .getByText('Adobe Creative Cloud')
      .closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getAllByRole('button', { name: 'Delete' })[0]!)

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDeleteGroup).toHaveBeenCalledWith('g1')
  })

  it('edits a payment inside a group', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [makeDeduction({ id: 'd1', description: 'Adobe July', group_id: 'g1' })],
    })

    await user.click(screen.getByRole('button', { name: /adobe creative cloud/i }))
    const payment = screen.getByText('Adobe July').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(payment).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ description: 'Adobe July', group_id: 'g1' }),
      ),
    )
  })

  it('deletes a payment from inside a group', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [makeDeduction({ id: 'd1', description: 'Adobe July', group_id: 'g1' })],
    })

    await user.click(screen.getByRole('button', { name: /adobe creative cloud/i }))
    const payment = screen.getByText('Adobe July').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(payment).getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('d1')
  })

  it('files a standalone deduction under a group', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [makeDeduction({ id: 'd1', description: 'Home office' })],
    })

    const card = screen.getByText('Home office').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /more details/i }))
    await user.click(groupPicker())
    await user.click(await screen.findByRole('option', { name: 'Adobe Creative Cloud' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('d1', expect.objectContaining({ group_id: 'g1' })),
    )
  })

  it('takes a payment back out of its group', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen({
      members: [will],
      groups: [makeGroup()],
      deductions: [makeDeduction({ id: 'd1', description: 'Adobe July', group_id: 'g1' })],
    })

    await user.click(screen.getByRole('button', { name: /adobe creative cloud/i }))
    const payment = screen.getByText('Adobe July').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(payment).getByRole('button', { name: /edit/i }))

    // The picker opens on the group the payment already sits in.
    expect(groupPicker()).toHaveValue('Adobe Creative Cloud')
    await user.click(groupPicker())
    await user.click(await screen.findByRole('option', { name: 'None' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('d1', expect.objectContaining({ group_id: null })),
    )
  })

  it('offers no group picker when adding a payment from one', async () => {
    const user = userEvent.setup()
    renderScreen({ members: [will], groups: [makeGroup()], deductions: [] })

    await user.click(screen.getByRole('button', { name: /adobe creative cloud/i }))
    await user.click(screen.getByRole('button', { name: /add payment/i }))

    // The group it was opened from is already the answer.
    expect(screen.queryByRole('combobox', { name: 'Group' })).not.toBeInTheDocument()
  })

  it('offers no group picker when the member has none', async () => {
    const user = userEvent.setup()
    renderScreen({ members: [will], groups: [], deductions: [makeDeduction()] })

    const card = screen.getByText('Home office').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))

    expect(screen.queryByRole('combobox', { name: 'Group' })).not.toBeInTheDocument()
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
      // Editing goes through a plain field update, not the receipt-replacing
      // RPC, so it carries the deduction's own fields — never a submission
      // shape with an `input`/`receiptPath` split.
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
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))
    await user.type(screen.getByLabelText(/description/i), 'Union fees')
    await user.type(screen.getByLabelText(/amount/i), '500')
    await user.click(screen.getByRole('button', { name: /^add deduction$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ description: 'Union fees', amount_cents: 500_00 }),
          receiptPath: null,
        }),
      ),
    )
  })

  it('offers no receipt controls on a settled row', () => {
    renderScreen({ receipts: [makeReceipt()] })

    expect(screen.getByRole('button', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^(add|replace) receipt$/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete receipt/i })).not.toBeInTheDocument()
  })

  it('shows no receipt link or attach control on a settled row without a receipt', () => {
    renderScreen()

    expect(screen.queryByRole('button', { name: 'Receipt' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^(add|replace) receipt$/i)).toBeNull()
  })

  it('puts the receipt link inline with the description', () => {
    renderScreen({ receipts: [makeReceipt()] })

    const title = screen.getByText('Home office').closest('p') as HTMLElement
    expect(within(title).getByRole('button', { name: 'Receipt' })).toBeInTheDocument()
  })

  it('attaches a receipt from the edit form', async () => {
    const user = userEvent.setup()
    const { onUploadReceipt } = renderScreen()

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /more details/i }))
    const input = screen.getByLabelText(/^(add|replace) receipt$/i)
    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    await user.upload(input, file)

    expect(onUploadReceipt).toHaveBeenCalledWith('d1', file, undefined)
  })

  it('opens a stored receipt in a new tab via its signed URL', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { signedUrl } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: 'Receipt' }))

    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith('h1/d1/abc-receipt.pdf'))
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://signed/url', '_blank', 'noopener'),
    )
  })

  it('does not open a tab when the signed URL cannot be created', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderScreen({ receipts: [makeReceipt()], signedUrl: vi.fn().mockResolvedValue(null) })

    await user.click(screen.getByRole('button', { name: 'Receipt' }))

    await waitFor(() => expect(open).not.toHaveBeenCalled())
  })

  it('confirms before deleting a receipt from the edit form', async () => {
    const user = userEvent.setup()
    const { onRemoveReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /more details/i }))
    await user.click(screen.getByRole('button', { name: /delete receipt/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onRemoveReceipt).toHaveBeenCalledWith(makeReceipt())
  })

  it('replaces an existing receipt from the edit form, passing the current one along', async () => {
    const user = userEvent.setup()
    const { onUploadReceipt } = renderScreen({ receipts: [makeReceipt()] })

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /more details/i }))
    const input = screen.getByLabelText(/^(add|replace) receipt$/i)
    const file = new File(['y'], 'newer.pdf', { type: 'application/pdf' })
    await user.upload(input, file)

    expect(onUploadReceipt).toHaveBeenCalledWith('d1', file, makeReceipt())
    expect(screen.getByLabelText('Replace receipt')).toBeInTheDocument()
  })

  describe('on desktop', () => {
    it('renders each deduction as a dense row with its receipt link inline', () => {
      setWideViewport()
      renderScreen({ members: [will], receipts: [makeReceipt()] })

      // No bordered card wraps a row.
      expect(screen.getByText('Home office').closest('.mantine-Card-root')).toBeNull()
      // The row amount plus the per-member total, both $1,200.00.
      expect(screen.getAllByText('$1,200.00')).toHaveLength(2)
      expect(screen.getByText(/1 Aug 2026/)).toBeInTheDocument()
      // The receipt link sits with the description.
      expect(screen.getByRole('button', { name: 'Receipt' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })
  })
  describe('drag and drop', () => {
    const drag = (id: string, overId: string | null) =>
      act(() => dnd.onDragEnd?.({ active: { id }, over: overId === null ? null : { id: overId } }))

    it('files a deduction into the group it is dropped on', async () => {
      const { onUpdate } = renderScreen({ members: [will], groups: [makeGroup()] })

      drag('d1', 'group:g1')

      await waitFor(() =>
        expect(onUpdate).toHaveBeenCalledWith(
          'd1',
          expect.objectContaining({
            member_id: 'm1',
            description: 'Home office',
            amount_cents: 1_200_00,
            group_id: 'g1',
          }),
        ),
      )
    })

    it('moves a payment to another group', async () => {
      const { onUpdate } = renderScreen({
        members: [will],
        deductions: [makeDeduction({ group_id: 'g1' })],
        groups: [makeGroup(), makeGroup({ id: 'g2', name: 'Trip' })],
      })

      drag('d1', 'group:g2')

      await waitFor(() =>
        expect(onUpdate).toHaveBeenCalledWith('d1', expect.objectContaining({ group_id: 'g2' })),
      )
    })

    it('clears the group of a payment dropped on the ungrouped list', async () => {
      const { onUpdate } = renderScreen({
        members: [will],
        deductions: [makeDeduction({ group_id: 'g1' })],
        groups: [makeGroup()],
      })

      drag('d1', 'ungrouped')

      await waitFor(() =>
        expect(onUpdate).toHaveBeenCalledWith('d1', expect.objectContaining({ group_id: null })),
      )
    })

    it('ignores a drop outside every target, on its own group, or on a group of another year', () => {
      const { onUpdate } = renderScreen({
        members: [will],
        deductions: [makeDeduction({ group_id: 'g1' })],
        groups: [makeGroup(), makeGroup({ id: 'g3', financial_year: 2026 })],
      })

      drag('d1', null)
      drag('d1', 'group:g1')
      drag('d1', 'group:g3')

      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('keeps a donation in the donations group and a work expense out of it', () => {
      const { onUpdate } = renderScreen({
        members: [will],
        deductions: [
          makeDeduction({ id: 'd1', category: 'donation', group_id: 'gd' }),
          makeDeduction({ id: 'd2' }),
        ],
        groups: [makeGroup({ id: 'gd', name: 'Donations', kind: 'donations' }), makeGroup()],
      })

      drag('d1', 'group:g1')
      drag('d1', 'ungrouped')
      drag('d2', 'group:gd')

      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('outlines only the targets that accept the dragged deduction', () => {
      renderScreen({
        members: [will],
        deductions: [makeDeduction({ group_id: 'g1' })],
        groups: [makeGroup(), makeGroup({ id: 'g2', name: 'Trip' })],
      })
      const targets = () => document.querySelectorAll('[data-drop-target="valid"]')
      expect(targets()).toHaveLength(0)

      act(() => dnd.onDragStart?.({ active: { id: 'd1' } }))

      // The other group and the ungrouped list; not the group it already sits in.
      expect(targets()).toHaveLength(2)
      expect(screen.getByText('Trip').closest('[data-drop-target="valid"]')).not.toBeNull()
      expect(screen.getByText('Adobe Creative Cloud').closest('[data-drop-target]')).toBeNull()

      drag('d1', null)
      expect(targets()).toHaveLength(0)
    })

    it('stops outlining targets when a drag is cancelled', () => {
      renderScreen({ members: [will], groups: [makeGroup()] })

      act(() => dnd.onDragStart?.({ active: { id: 'd1' } }))
      expect(document.querySelectorAll('[data-drop-target="valid"]')).not.toHaveLength(0)

      act(() => dnd.onDragCancel?.())
      expect(document.querySelectorAll('[data-drop-target="valid"]')).toHaveLength(0)
    })

    it('reports a move that fails', async () => {
      renderScreen({
        members: [will],
        groups: [makeGroup()],
        onUpdate: vi.fn().mockRejectedValue(new Error('nope')),
      })

      drag('d1', 'group:g1')

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not move/i)
    })
  })

  it('hands several receipts from the Add deduction card to a review of their own drafts', async () => {
    const user = userEvent.setup()
    renderScreen({ members: [will], deductions: [] })

    await user.click(screen.getByRole('button', { name: /add deduction/i }))
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, [
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
      new File(['x'], 'b.pdf', { type: 'application/pdf' }),
    ])

    expect(await screen.findByLabelText('a.pdf')).toBeInTheDocument()
    expect(screen.getByLabelText('b.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enter details manually/i })).toBeNull()
    expect(screen.queryByLabelText("Add Will's deductions from receipts")).toBeNull()
  })
})
