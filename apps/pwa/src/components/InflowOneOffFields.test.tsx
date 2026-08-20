import { describe, expect, it, vi } from 'vitest'
import type { OneOffDraft } from '../lib/oneOffInflow'
import { makeMember } from '../test/fixtures'
import { render, screen } from '../test/render'
import { InflowOneOffFields } from './InflowOneOffFields'

const member = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })

function draft(overrides: Partial<OneOffDraft> = {}): OneOffDraft {
  return { paidOn: '2026-09-12', treatment: 'ordinary', yearsOfService: '', ...overrides }
}

describe('InflowOneOffFields', () => {
  it('shows a redundancy’s tax-free amount, what is assessable, and the capped rate', () => {
    render(
      <InflowOneOffFields
        taxable
        amountCents={100_000_00}
        member={member}
        draft={draft({ treatment: 'genuine_redundancy', yearsOfService: 10 })}
        onChange={vi.fn()}
      />,
    )

    // $13,598 base plus $6,801 for each of 10 completed years.
    expect(screen.getByText(/\$81,608\.00 is tax free/)).toBeInTheDocument()
    expect(screen.getByText(/\$18,392\.00 is assessable income/)).toBeInTheDocument()
    expect(screen.getByText(/\$18,392\.00 of that is taxed at 30%/)).toBeInTheDocument()
    expect(screen.queryByText(/Your other income for the year/)).not.toBeInTheDocument()
  })

  it('says a termination payment’s concessional amount falls with other income', () => {
    render(
      <InflowOneOffFields
        taxable
        amountCents={50_000_00}
        member={member}
        draft={draft({ treatment: 'employment_termination' })}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Your other income for the year/)).toBeInTheDocument()
  })

  it('takes the lower rate from the member’s date of birth', () => {
    const { unmount } = render(
      <InflowOneOffFields
        taxable
        amountCents={50_000_00}
        member={makeMember({ id: 'm1', date_of_birth: '1960-01-01' })}
        draft={draft({ treatment: 'employment_termination' })}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/taxed at 15%/)).toBeInTheDocument()
    unmount()

    // Unused leave has a maximum rate of its own, which preservation age does not move.
    render(
      <InflowOneOffFields
        taxable
        amountCents={50_000_00}
        member={makeMember({ id: 'm1', date_of_birth: '1960-01-01' })}
        draft={draft({ treatment: 'unused_leave' })}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/taxed at 30%/)).toBeInTheDocument()
  })

  it('names no rate where nothing is taxed concessionally', () => {
    render(
      <InflowOneOffFields
        taxable
        amountCents={10_000_00}
        member={member}
        draft={draft()}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/\$10,000\.00 is assessable income/)).toBeInTheDocument()
    expect(screen.queryByText(/of that is taxed at/)).not.toBeInTheDocument()
    expect(screen.queryByText(/is tax free/)).not.toBeInTheDocument()
  })

  it('asks a non-taxable payment for its date alone', () => {
    render(
      <InflowOneOffFields
        taxable={false}
        amountCents={500_00}
        member={undefined}
        draft={draft()}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/paid on/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /tax treatment/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/is assessable income/)).not.toBeInTheDocument()
  })
})
