import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '../test/render'
import { MedicationsScreen } from './MedicationsScreen'
import type { Medication } from '../hooks/useMedications'

const vitaminD: Medication = {
  id: 'm1',
  name: 'Vitamin D',
  dose: '1000 IU daily',
  amount_cents: 20_00,
  frequency: 'monthly',
  interval_weeks: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}

function renderScreen(overrides: Partial<Parameters<typeof MedicationsScreen>[0]> = {}) {
  return render(
    <MedicationsScreen
      medications={[vitaminD]}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  )
}

describe('MedicationsScreen', () => {
  it('lists a medication with its dose and frequency', () => {
    renderScreen()
    expect(screen.getByText('Vitamin D')).toBeInTheDocument()
    expect(screen.getByText('1000 IU daily')).toBeInTheDocument()
    expect(screen.getByText('Monthly')).toBeInTheDocument()
    expect(screen.getByText('$20.00')).toBeInTheDocument()
  })

  it('shows the annual and fortnightly rollup total', () => {
    renderScreen()
    const total = screen
      .getByRole('heading', { name: 'Total' })
      .closest('.mantine-Card-root') as HTMLElement
    // Monthly $20 → $240/yr.
    expect(within(total).getByText('$240.00')).toBeInTheDocument()
  })

  it('omits the total card when there are no medications', () => {
    renderScreen({ medications: [] })
    expect(screen.queryByRole('heading', { name: 'Total' })).not.toBeInTheDocument()
    expect(screen.getByText('No medications yet.')).toBeInTheDocument()
  })

  it('adds a medication', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    renderScreen({ medications: [], onCreate })

    await user.click(screen.getByRole('button', { name: /add medication/i }))
    await user.type(screen.getByLabelText(/name/i), 'Ibuprofen')
    await user.type(screen.getByLabelText(/amount/i), '12.50')
    await user.click(screen.getByRole('button', { name: /^add medication$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Ibuprofen',
        dose: null,
        amount_cents: 12_50,
        frequency: 'monthly',
        interval_weeks: null,
      }),
    )
  })

  it('deletes a medication', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderScreen({ onDelete })

    await user.click(screen.getByRole('button', { name: 'Delete Vitamin D' }))

    expect(onDelete).toHaveBeenCalledWith('m1')
  })
})
