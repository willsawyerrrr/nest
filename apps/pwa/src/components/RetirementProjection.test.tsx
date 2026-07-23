import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { makeMember } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { RetirementProjection } from './RetirementProjection'

const member = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })

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

  it('persists every edited assumption', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<RetirementProjection entries={[entry]} preservationAge={60} />)

    const retirementAge = screen.getByLabelText(/retirement age/i)
    await user.clear(retirementAge)
    await user.type(retirementAge, '65')

    const inflation = screen.getByLabelText(/inflation/i)
    await user.clear(inflation)
    await user.type(inflation, '3')

    const growth = screen.getByLabelText(/contribution growth/i)
    await user.clear(growth)
    await user.type(growth, '4')

    unmount()
    render(<RetirementProjection entries={[entry]} preservationAge={60} />)
    expect(screen.getByLabelText(/retirement age/i)).toHaveValue('65')
    expect(screen.getByLabelText(/inflation/i)).toHaveValue('3%')
    expect(screen.getByLabelText(/contribution growth/i)).toHaveValue('4%')
  })

  it('projects a nil balance without dividing by zero when there is nothing to grow', async () => {
    const user = userEvent.setup()
    const emptyEntry = { member, currentBalanceCents: 0, netAnnualContributionCents: 0 }
    render(<RetirementProjection entries={[emptyEntry]} preservationAge={60} />)

    await user.type(screen.getByLabelText(/will current age/i), '40')

    // Nominal and today's-dollars both project to $0.00; the growth bar stays empty.
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
  })

  it('shows both real and nominal projected balances', async () => {
    const user = userEvent.setup()
    render(<RetirementProjection entries={[entry]} preservationAge={60} />)

    await user.type(screen.getByLabelText(/will current age/i), '59')

    // One year of growth keeps the figures close but distinct (real < nominal).
    const nominal = screen.getByText('Nominal').closest('div')!
    expect(within(nominal).getByText(/\$/)).toBeInTheDocument()
    expect(screen.getByText(/today.s dollars/i)).toBeInTheDocument()
  })
})
