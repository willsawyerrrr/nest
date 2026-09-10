import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { SuperContributionForm } from './SuperContributionForm'

const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })

const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

describe('SuperContributionForm', () => {
  it('submits an amount-mode contribution converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/contribution amount/i), '500')
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          member_id: 'm1',
          kind: 'salary_sacrifice',
          mode: 'amount',
          amount_cents: 500_00,
          percent_bp: null,
          frequency: 'fortnightly',
          contributor_member_id: null,
        }),
      ),
    )
  })

  it('stores a percent value as basis points', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Percent of salary'))
    await user.type(screen.getByLabelText(/percent of gross salary/i), '5.5')
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'percent', percent_bp: 550, amount_cents: null }),
      ),
    )
  })

  it('requires a contributor for a spouse contribution', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('combobox', { name: /kind/i }))
    await user.click(await screen.findByRole('option', { name: 'Spouse' }))
    await user.type(screen.getByLabelText(/contribution amount/i), '1000')

    // No contributor chosen yet: submit is blocked.
    expect(screen.getByRole('button', { name: /add contribution/i })).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: /contributor/i }))
    await user.click(await screen.findByRole('option', { name: 'Sam' }))
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'spouse', contributor_member_id: 'm2' }),
      ),
    )
  })

  it('captures the interval for an every-N-weeks contribution', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/contribution amount/i), '300')
    await user.click(screen.getByRole('combobox', { name: /frequency/i }))
    await user.click(await screen.findByRole('option', { name: 'Every N weeks' }))
    await user.type(screen.getByLabelText(/weeks between contributions/i), '3')
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: 'every_n_weeks', interval_count: 3 }),
      ),
    )
  })

  it('captures the interval for an every-N-months contribution and gates submit on it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/contribution amount/i), '300')
    await user.click(screen.getByRole('combobox', { name: /frequency/i }))
    await user.click(await screen.findByRole('option', { name: 'Every N months' }))
    // Without a valid interval the form cannot submit.
    expect(screen.getByRole('button', { name: /add contribution/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/months between contributions/i), '3')
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: 'every_n_months', interval_count: 3 }),
      ),
    )
  })

  it('flags the contribution as FHSS eligible when the switch is toggled on', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/contribution amount/i), '500')
    await user.click(screen.getByLabelText(/fhss eligible/i))
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fhss_eligible: true })),
    )
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/contribution amount/i), '500')
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('ignores a submit while the form is incomplete', () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <SuperContributionForm member={will} members={[will, sam]} onSubmit={onSubmit} />,
    )

    fireEvent.submit(container.querySelector('form')!)

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
