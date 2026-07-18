import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaxProfileForm } from './TaxProfileForm'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile } from '../hooks/useTaxProfiles'

const member: Member = {
  id: 'm1',
  household_id: 'h1',
  name: 'Will',
  email: null,
  user_id: 'u1',
  created_at: '',
  updated_at: '',
}

describe('TaxProfileForm', () => {
  it('submits residency, cover, and HELP debt converted to cents', async () => {
    const onSubmit = vi.fn()
    render(<TaxProfileForm member={member} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/residency/i), {
      target: { value: 'foreign_resident' },
    })
    fireEvent.click(screen.getByLabelText(/private hospital cover/i))
    fireEvent.change(screen.getByLabelText(/help debt/i), { target: { value: '25000' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        member_id: 'm1',
        residency: 'foreign_resident',
        has_private_hospital_cover: true,
        help_debt_cents: 2500000,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('prefills fields from an existing profile', () => {
    const profile: TaxProfile = {
      id: 't1',
      household_id: 'h1',
      member_id: 'm1',
      financial_year: 2027,
      residency: 'resident',
      has_private_hospital_cover: true,
      help_debt_cents: 1000000,
      created_at: '',
      updated_at: '',
    }
    render(<TaxProfileForm member={member} initial={profile} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/residency/i)).toHaveValue('resident')
    expect(screen.getByLabelText(/private hospital cover/i)).toBeChecked()
    expect(screen.getByLabelText(/help debt/i)).toHaveValue(10000)
  })

  it('shows an error when saving fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<TaxProfileForm member={member} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
