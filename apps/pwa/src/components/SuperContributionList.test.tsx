import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SuperContribution } from '../hooks/useSuperContributions'
import { makeMember } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { SuperContributionList } from './SuperContributionList'

const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

function makeContribution(overrides: Partial<SuperContribution> = {}): SuperContribution {
  return {
    id: 'sc1',
    household_id: 'h1',
    member_id: 'm1',
    financial_year: 2027,
    kind: 'salary_sacrifice',
    mode: 'amount',
    amount_cents: 500_00,
    percent_bp: null,
    frequency: 'fortnightly',
    interval_count: null,
    fhss_eligible: false,
    contributor_member_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const amountContribution = makeContribution()
const percentContribution = makeContribution({
  id: 'sc2',
  kind: 'spouse',
  mode: 'percent',
  amount_cents: null,
  percent_bp: 550,
  fhss_eligible: true,
  contributor_member_id: 'm2',
})

function renderList(overrides: Partial<Parameters<typeof SuperContributionList>[0]> = {}) {
  return render(
    <SuperContributionList
      member={will}
      members={[will, sam]}
      contributions={[amountContribution, percentContribution]}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn()}
      {...overrides}
    />,
  )
}

describe('SuperContributionList', () => {
  it('shows an empty hint when there are no contributions', () => {
    renderList({ contributions: [] })
    expect(screen.getByText(/no contributions yet/i)).toBeInTheDocument()
  })

  it('renders a flat amount and a percent-of-salary contribution with their details', () => {
    renderList()

    const flat = screen.getByText('Salary sacrifice').closest('.mantine-Card-root') as HTMLElement
    expect(within(flat).getByText('$500.00')).toBeInTheDocument()
    expect(within(flat).getByText('Fortnightly')).toBeInTheDocument()

    const spouse = screen.getByText('Spouse').closest('.mantine-Card-root') as HTMLElement
    expect(within(spouse).getByText('5.5% of salary')).toBeInTheDocument()
    expect(within(spouse).getByText('FHSS')).toBeInTheDocument()
    expect(within(spouse).getByText(/by Sam/)).toBeInTheDocument()
  })

  it('edits a contribution in place and saves the change', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderList({ onUpdate })

    const flat = screen.getByText('Salary sacrifice').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(flat).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('sc1', expect.objectContaining({})))
  })

  it('confirms before deleting a contribution', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderList({ onDelete })

    const flat = screen.getByText('Salary sacrifice').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(flat).getByRole('button', { name: /delete/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('sc1')
  })

  it('adds a new contribution', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderList({ contributions: [], onCreate })

    await user.click(screen.getByRole('button', { name: /add contribution/i }))
    await user.type(screen.getByLabelText(/contribution amount/i), '250')
    await user.click(screen.getByRole('button', { name: /add contribution/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 250_00 })),
    )
  })

  describe('on desktop', () => {
    it('renders each contribution as a dense row, noting the contributor', () => {
      setWideViewport()
      renderList()

      // No bordered card wraps a row.
      expect(screen.getByText('Salary sacrifice').closest('.mantine-Card-root')).toBeNull()
      expect(screen.getByText('$500.00')).toBeInTheDocument()
      expect(screen.getByText('5.5% of salary')).toBeInTheDocument()
      expect(screen.getByText('FHSS')).toBeInTheDocument()
      // The percent contribution carries its contributor caption; the flat one has none.
      expect(screen.getByText(/by Sam/)).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(2)
    })
  })
})
