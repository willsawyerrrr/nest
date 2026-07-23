import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../hooks/useAccounts'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { SuperCapSummary } from '../lib/tax'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { SuperScreen } from './SuperScreen'

const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

const profile: SuperProfile = {
  id: 'sp1',
  household_id: 'h1',
  member_id: 'm1',
  financial_year: 2027,
  fund_name: 'AustralianSuper',
  balance_as_of: '2026-07-01',
  linked_account_id: 'acc1',
  carry_forward_cap_cents: 0,
  sg_rate_override: null,
  created_at: '',
  updated_at: '',
}

const account: Account = {
  id: 'acc1',
  household_id: 'h1',
  name: 'AustralianSuper',
  type: 'other',
  source: 'manual',
  external_id: null,
  balance_cents: 100_000_00,
  currency: 'AUD',
  exclude_from_net_worth: false,
  owner_member_id: 'm1',
  created_at: '',
  updated_at: '',
}

const contribution: SuperContribution = {
  id: 'sc1',
  household_id: 'h1',
  member_id: 'm1',
  financial_year: 2027,
  kind: 'salary_sacrifice',
  mode: 'amount',
  amount_cents: 50000,
  percent_bp: null,
  frequency: 'fortnightly',
  interval_count: null,
  fhss_eligible: false,
  contributor_member_id: null,
  created_at: '',
  updated_at: '',
}

const capSummary: SuperCapSummary = {
  concessionalCents: 10_000_00,
  concessionalCapCents: 30_000_00,
  concessionalOverCap: false,
  nonConcessionalCents: 0,
  nonConcessionalCapCents: 120_000_00,
  nonConcessionalOverCap: false,
  coContributionCents: 0,
}

afterEach(() => localStorage.clear())

describe('SuperScreen', () => {
  it('renders a per-member super card with its caps, contributions, and the projection', () => {
    render(
      <SuperScreen
        members={[will, sam]}
        profiles={[profile]}
        accounts={[account]}
        contributions={[contribution]}
        capSummaries={new Map([['m1', capSummary]])}
        netContributionByMember={new Map([['m1', 13_000_00]])}
        preservationAge={60}
        financialYear={2027}
        onSave={vi.fn()}
        onCreateContribution={vi.fn()}
        onUpdateContribution={vi.fn()}
        onDeleteContribution={vi.fn()}
      />,
    )

    expect(screen.getByText(/super \(fy2027\)/i)).toBeInTheDocument()
    // Both members get a read row (and each also appears on the projection card).
    expect(screen.getAllByText('Will').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0)
    // Will's read row shows his fund and reads as a dated-baseline estimate; Sam,
    // with no profile, reads as a plain current balance. The edit input is hidden.
    expect(screen.getByText('AustralianSuper')).toBeInTheDocument()
    expect(screen.getByText('Estimated balance today')).toBeInTheDocument()
    expect(screen.getByText('Current balance')).toBeInTheDocument()
    expect(screen.queryByLabelText(/fund name/i)).not.toBeInTheDocument()
    expect(screen.getByText(/bring-forward may allow/i)).toBeInTheDocument()
    expect(screen.getAllByText('Contributions').length).toBeGreaterThan(0)
    expect(screen.getByText('Salary sacrifice')).toBeInTheDocument()
    expect(screen.getByText('Retirement projection')).toBeInTheDocument()

    // Will's contribution belongs to his section, not Sam's empty one.
    expect(screen.getByText(/no contributions yet/i)).toBeInTheDocument()
  })

  it('wires the member save through to the caller', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SuperScreen
        members={[will]}
        profiles={[]}
        accounts={[]}
        contributions={[]}
        capSummaries={new Map()}
        netContributionByMember={new Map()}
        preservationAge={67}
        financialYear={2027}
        onSave={onSave}
        onCreateContribution={vi.fn()}
        onUpdateContribution={vi.fn()}
        onDeleteContribution={vi.fn()}
      />,
    )

    // With no profile or cap summary the member still has a read row whose Edit
    // pencil reveals a form that saves through to the caller, tagged with the member.
    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText(/fund name/i), 'Hostplus')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(will, expect.objectContaining({ fundName: 'Hostplus' })),
    )
    // Saving returns the member to the read row.
    await waitFor(() => expect(screen.queryByLabelText(/fund name/i)).not.toBeInTheDocument())
  })

  it('returns to the read row on Cancel without saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <SuperScreen
        members={[will]}
        profiles={[]}
        accounts={[]}
        contributions={[]}
        capSummaries={new Map()}
        netContributionByMember={new Map()}
        preservationAge={67}
        financialYear={2027}
        onSave={onSave}
        onCreateContribution={vi.fn()}
        onUpdateContribution={vi.fn()}
        onDeleteContribution={vi.fn()}
      />,
    )

    // Opening the editor then cancelling drops back to the read row untouched.
    await user.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByLabelText(/fund name/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByLabelText(/fund name/i)).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })
})
