/**
 * The parity cases the bridge is held to. Each is an entry point, its JSON
 * input, and (written to the shared fixture file by the test) the output the
 * TypeScript engines produce. Swift's `Engine` runs the same inputs through the
 * bundle and must return the same output.
 */

import {
  summaryParityCases,
  taxParityCases,
  type SummaryParityCase,
  type TaxParityCase,
} from '../../household/src/goldenCases.ts'
import type { BreakdownItemInput, BreakdownsInput } from './breakdowns.ts'
import type { EstimateInput } from './estimate.ts'
import type { GoalQueueInput } from './index.ts'

export type ParityEntry =
  | 'estimateTax'
  | 'summariseHousehold'
  | 'projectGoalQueue'
  | 'summariseBreakdowns'
  | 'budgetOverview'

export interface ParityCase {
  name: string
  entry: ParityEntry
  input: unknown
}

const FINANCIAL_YEARS = { FY2026: 2026, FY2027: 2027 } as const

/** The bridge input for a household golden tax case. */
function taxInput(parityCase: TaxParityCase): EstimateInput {
  return {
    financialYear: FINANCIAL_YEARS[parityCase.config],
    inflows: parityCase.inflows,
    taxProfiles: parityCase.profiles,
    ...(parityCase.contributions && { contributions: parityCase.contributions }),
    ...(parityCase.helpDebts && { helpDebts: parityCase.helpDebts }),
    ...(parityCase.deductions && { deductions: parityCase.deductions }),
    ...(parityCase.paygWithheld && { paygWithheld: parityCase.paygWithheld }),
    ...(parityCase.members && { members: parityCase.members }),
    ...(parityCase.interestGoals && { interestGoals: parityCase.interestGoals }),
    ...(parityCase.interestSavers && { interestSavers: parityCase.interestSavers }),
  }
}

const salary = {
  member_id: 'm1',
  taxable: true,
  attracts_super: true,
  type: 'salary',
  schedule: 'annual',
  interval_count: null,
  amount_cents: 150_000_00,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
  paid_on: null,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
}

/**
 * Trades whose unit price and quantity multiply past 2^53 (`1000 units × 40e9
 * microdollars` is 4e19 in micro-units), so only the engine's `BigInt`
 * arithmetic keeps the cents exact. The sale's gain joins assessable income.
 */
const microdollarTradeCase: EstimateInput = {
  financialYear: 2027,
  inflows: [salary],
  taxProfiles: [{ member_id: 'm1', residency: 'resident', has_private_hospital_cover: false }],
  members: [{ id: 'm1', date_of_birth: null }],
  trades: [
    {
      member_id: 'm1',
      ticker: 'BIG',
      side: 'buy',
      traded_on: '2025-01-10',
      units: 1000.123457,
      price_per_unit_microdollars: 40_000_000_001,
      fee_cents: 995,
    },
    {
      member_id: 'm1',
      ticker: 'BIG',
      side: 'sell',
      traded_on: '2026-09-02',
      units: 1000.123457,
      price_per_unit_microdollars: 50_000_000_007,
      fee_cents: 995,
    },
  ],
}

const NOW = '2026-12-01T00:00:00Z'

const goalQueueCases: GoalQueueInput[] = [
  {
    active: [
      {
        goal: { targetAmountCents: 5_000_00, currentBalanceCents: 1_000_00 },
        fortnightlyContributionCents: 200_00,
      },
      {
        goal: {
          targetAmountCents: 20_000_00,
          currentBalanceCents: 4_000_00,
          targetDate: '2028-06-30',
          annualInterestBps: 450,
        },
        fortnightlyContributionCents: 350_00,
      },
    ],
    queued: [
      {
        goal: { targetAmountCents: 8_000_00, currentBalanceCents: 0, targetDate: '2030-01-01' },
        plannedContributionCents: 250_00,
      },
      { goal: { targetAmountCents: 3_000_00, currentBalanceCents: 3_000_00 } },
      {
        goal: { targetAmountCents: 12_000_00, currentBalanceCents: 500_00, annualInterestBps: 300 },
      },
    ],
    now: NOW,
  },
  {
    active: [],
    queued: [{ goal: { targetAmountCents: 1_000_00, currentBalanceCents: 0 } }],
    now: NOW,
  },
]

const summaryInput = (parityCase: SummaryParityCase) => ({
  bundle: parityCase.bundle,
  now: parityCase.nowIso,
})

const breakdownItem = (
  id: string,
  breakdown_id: string,
  amount_cents: number,
  frequency: BreakdownItemInput['frequency'],
  interval_count: number | null = null,
): BreakdownItemInput => ({ id, breakdown_id, amount_cents, frequency, interval_count })

/** Every frequency kind, including the interval ones that round, across two breakdowns and an empty one. */
const breakdownRollupCase: BreakdownsInput = {
  breakdownIds: ['b1', 'b2', 'b3'],
  items: [
    breakdownItem('i1', 'b1', 300_00, 'monthly'),
    breakdownItem('i2', 'b1', 400_00, 'quarterly'),
    breakdownItem('i3', 'b1', 25_00, 'weekly'),
    breakdownItem('i4', 'b2', 1_000_00, 'annual'),
    breakdownItem('i5', 'b2', 333_33, 'every_n_weeks', 3),
    breakdownItem('i6', 'b2', 777_77, 'every_n_months', 5),
    breakdownItem('i7', 'b2', 1_00, 'every_n_weeks'),
    breakdownItem('i8', 'b2', 90_00, 'biannual'),
    breakdownItem('i9', 'b2', 40_00, 'fortnightly'),
  ],
}

const budgetOverviewCase = {
  lines: [
    { group: 'needs', amountCents: 1_000_00, frequency: 'monthly' },
    { group: 'discretionary', amountCents: 50_00, frequency: 'fortnightly' },
    {
      group: 'discretionary',
      amountCents: 80_00,
      frequency: 'fortnightly',
      allowanceMemberId: 'ada',
    },
    { group: 'savings', amountCents: 300_00, frequency: 'every_n_weeks', interval: 3 },
    { group: 'investments', amountCents: 1_200_00, frequency: 'annual' },
  ],
  allowances: [{ memberId: 'ada', amountCents: 200_00, frequency: 'fortnightly' }],
  temporaryItems: [
    { contributionCents: 80_00, targetDate: '2027-03-31' },
    { contributionCents: 25_00, targetDate: '2026-01-31' },
  ],
  now: '2026-12-01T00:00:00Z',
}

export const parityCases: ParityCase[] = [
  ...taxParityCases.map((parityCase) => ({
    name: `tax estimate: ${parityCase.label}`,
    entry: 'estimateTax' as const,
    input: taxInput(parityCase),
  })),
  {
    name: 'tax estimate: microdollar trades past 2^53',
    entry: 'estimateTax',
    input: microdollarTradeCase,
  },
  ...summaryParityCases.map((parityCase) => ({
    name: `fortnightly buffer: ${parityCase.label}`,
    entry: 'summariseHousehold' as const,
    input: summaryInput(parityCase),
  })),
  ...goalQueueCases.map((input, index) => ({
    name: `goal queue: case ${index + 1}`,
    entry: 'projectGoalQueue' as const,
    input,
  })),
  {
    name: 'breakdown roll-up: every frequency',
    entry: 'summariseBreakdowns',
    input: breakdownRollupCase,
  },
  { name: 'budget overview: allowance draw', entry: 'budgetOverview', input: budgetOverviewCase },
]
