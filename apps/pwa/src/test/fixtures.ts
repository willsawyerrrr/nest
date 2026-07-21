import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { Saver } from '../hooks/useSavers'
import type { TemporaryItem } from '../hooks/useTemporaryItems'

/** Builds a household member row, overriding any field a test cares about. */
export function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    household_id: 'h1',
    name: 'Will',
    email: null,
    user_id: 'u1',
    up_connected_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds an inflow row, defaulting to a fortnightly taxable salary. */
export function makeInflow(overrides: Partial<Inflow> = {}): Inflow {
  return {
    id: 'i1',
    household_id: 'h1',
    member_id: 'm1',
    name: 'Day job',
    taxable: true,
    type: 'salary',
    schedule: 'fortnightly',
    interval_count: null,
    amount_cents: 500000,
    hourly_rate_cents: null,
    hours_per_period: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a savings-goal row with a manual balance and no linked saver. */
export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    household_id: 'h1',
    name: 'Goal',
    target_amount_cents: 1_000_000,
    target_date: null,
    current_balance_cents: 0,
    linked_account_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds an accounts row for a synced Up saver. */
export function makeSaver(overrides: Partial<Saver> = {}): Saver {
  return {
    id: 'a1',
    household_id: 'h1',
    owner_member_id: null,
    name: 'Up Saver',
    type: 'savings',
    source: 'up',
    external_id: 'up-a1',
    balance_cents: 0,
    currency: 'AUD',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a budget-line row, defaulting to a fortnightly savings line. */
export function makeBudgetLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: Math.random().toString(),
    household_id: 'h1',
    line_group: 'savings',
    name: 'Line',
    amount_cents: 50_000,
    frequency: 'fortnightly',
    interval_count: null,
    goal_id: null,
    destination_account_id: null,
    breakdown_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a temporary-item row with a dated contribution. */
export function makeTemporaryItem(overrides: Partial<TemporaryItem> = {}): TemporaryItem {
  return {
    id: 't1',
    household_id: 'h1',
    name: 'Holiday',
    contribution_cents: 12000,
    target_date: '2027-08-03',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}
