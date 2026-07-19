import { afterEach, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '../test/render'
import { RetirementProjection } from './RetirementProjection'
import type { Member } from '../hooks/useMembers'

const member: Member = {
  id: 'm1',
  household_id: 'h1',
  name: 'Will',
  email: null,
  user_id: 'u1',
  up_connected_at: null,
  created_at: '',
  updated_at: '',
}

const entry = {
  member,
  currentBalanceCents: 100_000_00,
  netAnnualContributionCents: 20_000_00,
}

afterEach(() => localStorage.clear())

describe('RetirementProjection', () => {
  it('prompts for the member age until it is entered', () => {
    render(<RetirementProjection entries={[entry]} preservationAge={60} />)
    expect(screen.getByText(/enter will.s current age/i)).toBeInTheDocument()
  })

  it('defaults the retirement age to the preservation age', () => {
    render(<RetirementProjection entries={[entry]} preservationAge={67} />)
    expect(screen.getByLabelText(/retirement age/i)).toHaveValue('67')
  })

  it('projects the balance once an age is entered and persists the age', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<RetirementProjection entries={[entry]} preservationAge={60} />)

    await user.type(screen.getByLabelText(/will current age/i), '35')

    expect(await screen.findByText('25')).toBeInTheDocument() // years to retirement
    expect(screen.getByText(/projected at retirement/i)).toBeInTheDocument()

    // Age persists across a remount via localStorage.
    unmount()
    render(<RetirementProjection entries={[entry]} preservationAge={60} />)
    expect(screen.getByLabelText(/will current age/i)).toHaveValue('35')
  })

  it('persists edited assumptions', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<RetirementProjection entries={[entry]} preservationAge={60} />)

    const returnInput = screen.getByLabelText(/expected return/i)
    await user.clear(returnInput)
    await user.type(returnInput, '9')

    unmount()
    render(<RetirementProjection entries={[entry]} preservationAge={60} />)
    expect(screen.getByLabelText(/expected return/i)).toHaveValue('9%')
  })

  it('shows both real and nominal projected balances', async () => {
    const user = userEvent.setup()
    render(<RetirementProjection entries={[entry]} preservationAge={60} />)

    await user.type(screen.getByLabelText(/will current age/i), '59')

    // One year of growth keeps the figures close but distinct (real < nominal).
    const nominal = screen.getByText('Nominal').closest('div')!
    expect(within(nominal).getByText(/\$/)).toBeInTheDocument()
    expect(screen.getByText(/today's dollars/i)).toBeInTheDocument()
  })
})
