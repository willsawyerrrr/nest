import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '../test/render'
import { TaxProfileList } from './TaxProfileList'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile } from '../hooks/useTaxProfiles'

const members: Member[] = [
  {
    id: 'm1',
    household_id: 'h1',
    name: 'Will',
    email: null,
    user_id: 'u1',
    created_at: '',
    updated_at: '',
  },
  {
    id: 'm2',
    household_id: 'h1',
    name: 'Sam',
    email: null,
    user_id: 'u2',
    created_at: '',
    updated_at: '',
  },
]

const samProfile: TaxProfile = {
  id: 't2',
  household_id: 'h1',
  member_id: 'm2',
  financial_year: 2027,
  residency: 'foreign_resident',
  has_private_hospital_cover: true,
  help_debt_cents: 1000000,
  created_at: '',
  updated_at: '',
}

function card(name: string): HTMLElement {
  return screen.getByText(name).closest('.mantine-Card-root') as HTMLElement
}

describe('TaxProfileList', () => {
  it('summarises each member, defaulting to Resident without a profile', () => {
    render(<TaxProfileList members={members} profiles={[samProfile]} onUpsert={vi.fn()} />)

    expect(within(card('Will')).getByText('Resident')).toBeInTheDocument()
    const sam = card('Sam')
    expect(within(sam).getByText('Foreign resident')).toBeInTheDocument()
    expect(within(sam).getByText('Hospital cover')).toBeInTheDocument()
    expect(within(sam).getByText(/HELP \$10,000\.00/)).toBeInTheDocument()
  })

  it('reveals the edit form and returns to the row after saving', async () => {
    const user = userEvent.setup()
    const onUpsert = vi.fn().mockResolvedValue(undefined)
    render(<TaxProfileList members={members} profiles={[]} onUpsert={onUpsert} />)

    await user.click(within(card('Will')).getByRole('button', { name: /edit/i }))
    expect(screen.getByRole('combobox', { name: /residency/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onUpsert).toHaveBeenCalledWith(expect.objectContaining({ member_id: 'm1' })),
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
