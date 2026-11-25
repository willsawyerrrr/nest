import { describe, expect, it } from 'vitest'
import { cashFlowLines, type CashFlowBundle } from './cashFlow.ts'

const line = { line_group: 'needs', amount_cents: 300_00, frequency: 'fortnightly' }
const bundle: CashFlowBundle = {
  inflows: [],
  taxProfiles: [],
  contributions: [],
  helpDebts: [],
  deductions: [],
  members: [],
  budgetLines: [
    { ...line, name: 'Gym', interval_count: null, starts_on: '2026-12-01' },
    {
      ...line,
      name: 'Rent',
      interval_count: null,
      starts_on: '2026-01-01',
      retired_on: '2026-12-01',
    },
  ],
  memberAllowances: [],
  temporaryItems: [],
  savingsGoals: [],
  savers: [],
  timeZone: 'Australia/Brisbane',
}

describe('cashFlowLines', () => {
  it("draws a Brisbane household's lines active on Brisbane's own day", () => {
    const names = (now: string) =>
      cashFlowLines(bundle, new Date(now)).map((cashFlowLine) => cashFlowLine.name)
    // 12:30am on 1 December in Brisbane.
    expect(names('2026-11-30T14:30:00Z')).toEqual(['Gym'])
    // 11:30pm on 30 November in Brisbane, already 1 December in Sydney.
    expect(names('2026-11-30T13:30:00Z')).toEqual(['Rent'])
  })
})
