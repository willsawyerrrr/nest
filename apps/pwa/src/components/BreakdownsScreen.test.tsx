import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Breakdown } from '../hooks/useBreakdowns'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { BreakdownsScreen } from './BreakdownsScreen'

function breakdown(overrides: Partial<Breakdown> = {}): Breakdown {
  return {
    id: 'b1',
    household_id: 'h',
    name: 'Medications',
    line_group: 'needs',
    kind: 'generic',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function renderScreen(overrides: Partial<Parameters<typeof BreakdownsScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BreakdownsScreen
        breakdowns={[breakdown()]}
        totalsByBreakdownId={new Map([['b1', 260_00]])}
        onCreate={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('BreakdownsScreen', () => {
  it('lists each breakdown with its group and rolled-up totals, linking to its editor', () => {
    renderScreen()

    const card = screen.getByText('Medications').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('Needs')).toBeInTheDocument()
    // $260/year → $10.00/fn.
    expect(within(card).getByText('$10.00')).toBeInTheDocument()
    expect(within(card).getByText('$260.00 / year')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Medications/ })).toHaveAttribute(
      'href',
      '/breakdowns/b1',
    )
  })

  it('shows an empty hint with no breakdowns', () => {
    renderScreen({ breakdowns: [], totalsByBreakdownId: new Map() })
    expect(screen.getByText(/no breakdowns yet/i)).toBeInTheDocument()
  })

  it('creates a generic breakdown from the new-breakdown form', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    renderScreen({ onCreate })

    await user.click(screen.getByRole('button', { name: /add breakdown/i }))
    await user.type(screen.getByLabelText(/name/i), 'Holiday')
    await user.click(screen.getByRole('combobox', { name: /group/i }))
    await user.click(await screen.findByRole('option', { name: 'Wants' }))
    await user.click(screen.getByRole('button', { name: /add breakdown/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Holiday',
        line_group: 'wants',
        kind: 'generic',
      }),
    )
  })

  it('closes the new-breakdown form on cancel', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole('button', { name: /add breakdown/i }))
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument()
  })

  it('ignores a submit while the name is blank', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const { container } = renderScreen({ onCreate })

    await user.click(screen.getByRole('button', { name: /add breakdown/i }))
    const form = container.querySelector('form') as HTMLFormElement
    form.requestSubmit()

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows an error when creating the breakdown fails', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(new Error('nope'))
    renderScreen({ onCreate })

    await user.click(screen.getByRole('button', { name: /add breakdown/i }))
    await user.type(screen.getByLabelText(/name/i), 'Holiday')
    await user.click(screen.getByRole('button', { name: /add breakdown/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create this breakdown/i)
  })

  it('renders each breakdown as a dense row on desktop, still linking to its editor', () => {
    setWideViewport()
    renderScreen()

    // No bordered card wraps a row.
    expect(screen.getByText('Medications').closest('.mantine-Card-root')).toBeNull()
    expect(screen.getByText('Needs')).toBeInTheDocument()
    expect(screen.getByText('$10.00')).toBeInTheDocument()
    expect(screen.getByText('$260.00 / year')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Medications/ })).toHaveAttribute(
      'href',
      '/breakdowns/b1',
    )
  })
})
