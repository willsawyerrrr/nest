import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { TaxProfileForm } from './TaxProfileForm'

const member = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })

describe('TaxProfileForm', () => {
  it('submits residency and cover', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TaxProfileForm member={member} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('combobox', { name: /residency/i }))
    await user.click(await screen.findByRole('option', { name: 'Foreign resident' }))
    await user.click(screen.getByLabelText(/private hospital cover/i))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        member_id: 'm1',
        residency: 'foreign_resident',
        has_private_hospital_cover: true,
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
      created_at: '',
      updated_at: '',
    }
    render(<TaxProfileForm member={member} initial={profile} onSubmit={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: /residency/i })).toHaveValue('Resident')
    expect(screen.getByLabelText(/private hospital cover/i)).toBeChecked()
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<TaxProfileForm member={member} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
