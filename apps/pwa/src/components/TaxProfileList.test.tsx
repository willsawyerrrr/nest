import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import { makeMember } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { TaxProfileList } from './TaxProfileList'

const members = [
  makeMember({ id: 'm1', name: 'Will', user_id: 'u1' }),
  makeMember({ id: 'm2', name: 'Sam', user_id: 'u2', date_of_birth: '1990-03-04' }),
]

const samProfile: TaxProfile = {
  id: 't2',
  household_id: 'h1',
  member_id: 'm2',
  financial_year: 2027,
  residency: 'foreign_resident',
  has_private_hospital_cover: true,
  created_at: '',
  updated_at: '',
}

function card(name: string): HTMLElement {
  const id = members.find((member) => member.name === name)!.id
  return screen.getByTestId(`tax-profile-${id}`)
}

describe('TaxProfileList', () => {
  it('summarises each member, defaulting to Resident without a profile', () => {
    render(<TaxProfileList members={members} profiles={[samProfile]} onUpsert={vi.fn()} />)

    expect(within(card('Will')).getByText('Resident')).toBeInTheDocument()
    const sam = card('Sam')
    expect(within(sam).getByText('Foreign resident')).toBeInTheDocument()
    expect(within(sam).getByText('Hospital cover')).toBeInTheDocument()
    expect(within(sam).getByText('Born 4 Mar 1990')).toBeInTheDocument()
    expect(within(card('Will')).getByText('No hospital cover')).toBeInTheDocument()
    expect(within(card('Will')).getByText('No date of birth')).toBeInTheDocument()
  })

  it('lays each member out as an aligned row on a wide viewport', async () => {
    setWideViewport()
    const user = userEvent.setup()
    render(<TaxProfileList members={members} profiles={[samProfile]} onUpsert={vi.fn()} />)

    const sam = card('Sam')
    expect(sam).not.toHaveClass('mantine-Card-root')
    expect(within(sam).getByText('Foreign resident')).toBeInTheDocument()
    expect(within(sam).getByText('Hospital cover')).toBeInTheDocument()
    expect(within(sam).getByText('Born 4 Mar 1990')).toBeInTheDocument()
    expect(within(card('Will')).getByText('No hospital cover')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Sam’s tax profile' }))
    expect(screen.getByRole('combobox', { name: /residency/i })).toBeInTheDocument()
  })

  it('reveals the edit form and returns to the row after saving', async () => {
    const user = userEvent.setup()
    const onUpsert = vi.fn().mockResolvedValue(undefined)
    render(<TaxProfileList members={members} profiles={[]} onUpsert={onUpsert} />)

    await user.click(within(card('Will')).getByRole('button', { name: /edit/i }))
    expect(screen.getByRole('combobox', { name: /residency/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ profile: expect.objectContaining({ member_id: 'm1' }) }),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument(),
    )
  })

  it('closes the form on cancel without upserting', async () => {
    const user = userEvent.setup()
    const onUpsert = vi.fn()
    render(<TaxProfileList members={members} profiles={[]} onUpsert={onUpsert} />)

    await user.click(within(card('Will')).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(onUpsert).not.toHaveBeenCalled()
  })
})
