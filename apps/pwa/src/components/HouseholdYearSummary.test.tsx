import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { estimateHouseholdTax, FY2027_CONFIG, type TaxProfileInput } from '@nest/tax'
import { makeMember } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { HouseholdYearSummary } from './HouseholdYearSummary'

const members = [makeMember({ id: 'a', name: 'Alex' }), makeMember({ id: 'b', name: 'Bea' })]

function renderSummary(
  salaries: [number, number],
  covered: [boolean, boolean] = [false, false],
  names = members,
  gainCents = 0,
) {
  const profiles: TaxProfileInput[] = ['a', 'b'].map((memberId, index) => ({
    memberId,
    residency: 'resident',
    privateHospitalCover: covered[index]!,
    helpDebtCents: 0,
  }))
  const estimate = estimateHouseholdTax(
    [
      { memberId: 'a', type: 'salary', schedule: 'annual', amountCents: salaries[0] },
      { memberId: 'b', type: 'salary', schedule: 'annual', amountCents: salaries[1] },
    ],
    profiles,
    FY2027_CONFIG,
    undefined,
    undefined,
    undefined,
    new Map([['a', gainCents]]),
  )
  return render(
    <HouseholdYearSummary
      members={names}
      estimate={estimate}
      config={FY2027_CONFIG}
      financialYear={2027}
    />,
  )
}

describe('HouseholdYearSummary', () => {
  it('shows combined totals and a per-member breakdown', () => {
    renderSummary([150_000_00, 61_000_00])
    expect(screen.getByRole('heading', { name: 'Household (FY2027)' })).toBeInTheDocument()
    expect(screen.getByText('Gross income').nextSibling).toHaveTextContent('$211,000.00')
    const table = screen.getByRole('table', { name: 'Household members' })
    expect(within(table).getByText('Alex')).toBeInTheDocument()
    expect(within(table).getByText('Bea')).toBeInTheDocument()
    expect(within(table).getAllByText('$150,000.00')).toHaveLength(2)
  })

  it('lists the net capital gain only when there is one', () => {
    const { unmount } = renderSummary([100_000_00, 50_000_00])
    expect(screen.queryByText('of which net capital gain')).not.toBeInTheDocument()
    unmount()
    renderSummary([100_000_00, 50_000_00], [false, false], members, 20_000_00)
    expect(screen.getByText('of which net capital gain').nextSibling).toHaveTextContent(
      '$20,000.00',
    )
  })

  it('reports a household under the threshold with its distance to the next', () => {
    renderSummary([100_000_00, 50_000_00])
    expect(screen.getByText('Under the family threshold')).toBeInTheDocument()
    expect(screen.getByText('$60,000.00 to the next threshold at $210,000.00.')).toBeInTheDocument()
    expect(screen.queryByText('Surcharge')).not.toBeInTheDocument()
  })

  it('reports liability, tier and surcharge when over the threshold uncovered', () => {
    renderSummary([150_000_00, 100_000_00])
    expect(screen.getByText('Liable at 1.25% (tier 2)')).toBeInTheDocument()
    expect(screen.getByText('Surcharge')).toBeInTheDocument()
  })

  it('notes cover when over a threshold but every member is covered', () => {
    renderSummary([150_000_00, 100_000_00], [true, true])
    expect(
      screen.getByText(/Over the tier 2 threshold, but every member holds private hospital cover/),
    ).toBeInTheDocument()
  })

  it('says so at the top tier', () => {
    renderSummary([200_000_00, 200_000_00])
    expect(screen.getByText('Already at the top tier.')).toBeInTheDocument()
  })

  it('falls back to a generic name for a member not in the list', () => {
    renderSummary([100_000_00, 50_000_00], [false, false], [members[0]!])
    expect(screen.getByRole('cell', { name: 'Member' })).toBeInTheDocument()
  })

  it('raises the thresholds with dependent children', async () => {
    const user = userEvent.setup()
    renderSummary([150_000_00, 62_000_00])
    expect(screen.getByText(/Liable at 1% \(tier 1\)/)).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Dependent children' })
    await user.clear(input)
    await user.type(input, '4')
    expect(screen.getByText('Under the family threshold')).toBeInTheDocument()
    await user.clear(input)
    expect(screen.getByText(/Liable at 1% \(tier 1\)/)).toBeInTheDocument()
  })
})
