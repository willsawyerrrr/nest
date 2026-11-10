import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import {
  contributionForGoal,
  goalDisplay,
  linkedSaver,
  partitionGoals,
  queuedGoalDisplay,
  queuedProjectionsById,
} from './goalProjection'

/**
 * The household the native Goals screen is held to. Rows are written in full, as
 * PostgREST returns them; the figures are what the PWA's own `goalProjection`
 * helpers produce from them (partition, funding, status flag and ETA line). The
 * fixture is committed beside the iOS tests (`vitest -u` rewrites it);
 * `GoalsParityTests` runs the same rows through the screen's assembly and the
 * bundled engine and must produce identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/goals-parity.json'
const NOW = '2026-12-01T12:00:00Z'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const line = (overrides: Partial<BudgetLine>): BudgetLine => ({
  ...base,
  id: 'b',
  name: 'Line',
  line_group: 'savings',
  amount_cents: 0,
  frequency: 'fortnightly',
  interval_count: null,
  allowance_member_id: null,
  breakdown_id: null,
  destination_account_id: null,
  gift_recipient_member_id: null,
  goal_id: null,
  is_gift_line: false,
  management_url: null,
  ...overrides,
})

const goal = (overrides: Partial<Goal>): Goal => ({
  ...base,
  id: 'g',
  name: 'Goal',
  target_amount_cents: 0,
  current_balance_cents: 0,
  annual_interest_bps: null,
  linked_account_id: null,
  planned_contribution_cents: null,
  queue_position: null,
  target_date: null,
  ...overrides,
})

const saver = (overrides: Partial<Saver>): Saver => ({
  ...base,
  id: 's',
  name: 'Saver',
  balance_cents: 0,
  currency: 'AUD',
  deleted_from_source_at: null,
  exclude_from_net_worth: false,
  external_id: null,
  owner_member_id: null,
  source: 'up',
  type: 'savings',
  ...overrides,
})

const rows = {
  members: [],
  budgetLines: [
    line({ id: 'b1', name: 'Holiday', amount_cents: 300_00, goal_id: 'g1' }),
    line({
      id: 'b2',
      name: 'House',
      amount_cents: 900_00,
      goal_id: 'g2',
      line_group: 'investments',
    }),
    line({
      id: 'b3',
      name: 'Rent',
      line_group: 'needs',
      amount_cents: 2_400_00,
      frequency: 'monthly',
    }),
  ],
  savers: [
    saver({ id: 's1', name: 'Rainy day', balance_cents: 1_250_00 }),
    saver({ id: 's2', name: 'Old pot', balance_cents: 40_00, deleted_from_source_at: STAMP }),
  ],
  savingsGoals: [
    goal({
      id: 'g1',
      name: 'Holiday',
      target_amount_cents: 15_000_00,
      current_balance_cents: 3_000_00,
    }),
    goal({
      id: 'g2',
      name: 'House deposit',
      target_amount_cents: 60_000_00,
      current_balance_cents: 10_000_00,
      target_date: '2029-06-30',
      annual_interest_bps: 450,
    }),
    goal({
      id: 'g3',
      name: 'Emergency fund',
      target_amount_cents: 5_000_00,
      linked_account_id: 's1',
      queue_position: 0,
    }),
    goal({
      id: 'g4',
      name: 'Car',
      target_amount_cents: 20_000_00,
      current_balance_cents: 500_00,
      target_date: '2032-01-31',
      planned_contribution_cents: 150_00,
      queue_position: 1,
    }),
    goal({
      id: 'g5',
      name: 'Laptop',
      target_amount_cents: 2_000_00,
      current_balance_cents: 2_000_00,
      queue_position: 2,
    }),
    goal({
      id: 'g6',
      name: 'Bike',
      target_amount_cents: 3_000_00,
      linked_account_id: 's2',
      annual_interest_bps: 300,
    }),
  ],
}

/** An ETA node as the text it renders. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('')
  }
  return textOf((node as { props: { children?: ReactNode } }).props.children)
}

function figures() {
  const { active, queued } = partitionGoals(rows.savingsGoals, rows.budgetLines)
  const projections = queuedProjectionsById(
    rows.savingsGoals,
    rows.budgetLines,
    rows.savers,
    new Date(NOW),
  )
  const shown = (g: Goal, display: ReturnType<typeof goalDisplay>) => ({
    id: g.id,
    contributionCents: contributionForGoal(g.id, rows.budgetLines),
    percent: Math.round(display.percent),
    balanceCents: display.currentBalanceCents,
    status: display.status,
    eta: textOf(display.eta),
  })
  return {
    active: active.map((g) =>
      shown(
        g,
        goalDisplay(g, linkedSaver(g, rows.savers), contributionForGoal(g.id, rows.budgetLines)),
      ),
    ),
    queued: queued.map((g) =>
      shown(g, queuedGoalDisplay(g, linkedSaver(g, rows.savers), projections.get(g.id)!)),
    ),
  }
}

describe('the native Goals parity fixture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => vi.useRealTimers())

  it('matches what the PWA Goals screen computes from the same rows', async () => {
    const text = `${JSON.stringify(
      [{ name: 'active and queued goals', now: NOW, rows, expected: figures() }],
      null,
      2,
    )}\n`
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })
})
