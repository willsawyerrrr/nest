import { assert, assertEquals } from '@std/assert'
import type { DeliveryOutcome, PushDevice, PushPayload } from '../_shared/webpush.ts'
import {
  daysUntil,
  evaluateHousehold,
  formatCents,
  type HouseholdBundle,
  type LogRow,
  type NotifyEvalDeps,
  type PreferenceRow,
  runNotifyEval,
  type SubscriptionRow,
  type Trigger,
  upcomingJune30,
} from './eval.ts'

const NOW = new Date('2027-02-15T09:00:00Z')

/** A salary big enough to leave a comfortably positive buffer. */
const SALARY = {
  member_id: 'm-1',
  taxable: true,
  type: 'salary',
  schedule: 'fortnightly',
  amount_cents: 3_000_00,
  hourly_rate_cents: null,
  hours_per_period: null,
  interval_count: null,
  starts_on: null,
  ends_on: null,
  paid_on: null,
  attracts_super: true,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
} as const

/**
 * A household in the black by default — a salary and its tax profile, no plan —
 * so a test of one trigger is not tripped by the buffer going negative on the
 * side.
 */
function bundle(overrides: Partial<HouseholdBundle> = {}): HouseholdBundle {
  return {
    inflows: [SALARY],
    taxProfiles: [{ member_id: 'm-1', residency: 'resident', has_private_hospital_cover: false }],
    contributions: [],
    helpDebts: [],
    deductions: [],
    members: [{ id: 'm-1', date_of_birth: null }],
    budgetLines: [],
    savingsGoals: [],
    temporaryItems: [],
    accountBalances: [],
    savers: [],
    ...overrides,
  }
}

// ── evaluateHousehold: the four triggers ────────────────────────────────────

Deno.test('buffer_negative fires when the plan spends more than comes in', () => {
  const firings = evaluateHousehold(
    bundle({
      inflows: [],
      taxProfiles: [],
      budgetLines: [{
        line_group: 'needs',
        amount_cents: 500_00,
        frequency: 'fortnightly',
        interval_count: null,
        goal_id: null,
      }],
    }),
    NOW,
  )
  assertEquals(firings.map((f) => f.trigger), ['buffer_negative'])
  assertEquals(firings[0].dedupeKey, '2027')
  assertEquals(firings[0].payload.url, '/summary')
  assert(firings[0].payload.body.includes('$500.00'))
})

Deno.test('buffer_negative does not fire when income covers the plan', () => {
  const firings = evaluateHousehold(
    bundle({
      inflows: [SALARY],
      taxProfiles: [{ member_id: 'm-1', residency: 'resident', has_private_hospital_cover: false }],
      budgetLines: [{
        line_group: 'needs',
        amount_cents: 100_00,
        frequency: 'fortnightly',
        interval_count: null,
        goal_id: null,
      }],
    }),
    NOW,
  )
  assertEquals(firings, [])
})

Deno.test('a non-taxable inflow lifts available cash and clears the buffer', () => {
  const withReimbursement = evaluateHousehold(
    bundle({
      inflows: [{ ...SALARY, taxable: false, type: 'reimbursement', amount_cents: 800_00 }],
      budgetLines: [{
        line_group: 'needs',
        amount_cents: 500_00,
        frequency: 'fortnightly',
        interval_count: null,
        goal_id: null,
      }],
    }),
    NOW,
  )
  assertEquals(withReimbursement, [])
})

Deno.test('goal_eta_slipped fires for a dated goal the contribution cannot reach in time', () => {
  const firings = evaluateHousehold(
    bundle({
      savingsGoals: [{
        id: 'g-1',
        name: 'House deposit',
        target_amount_cents: 100_000_00,
        current_balance_cents: 0,
        target_date: '2027-06-01',
        annual_interest_bps: null,
        linked_account_id: null,
      }],
      budgetLines: [{
        line_group: 'savings',
        amount_cents: 100_00,
        frequency: 'fortnightly',
        interval_count: null,
        goal_id: 'g-1',
      }],
    }),
    NOW,
  )
  assertEquals(firings.map((f) => f.trigger), ['goal_eta_slipped'])
  assertEquals(firings[0].dedupeKey, 'g-1:2027-06-01')
  assert(firings[0].payload.body.includes('House deposit'))
})

Deno.test('goal_eta_slipped does not fire when the contribution reaches the target in time', () => {
  const firings = evaluateHousehold(
    bundle({
      savingsGoals: [{
        id: 'g-1',
        name: 'Holiday',
        target_amount_cents: 2_000_00,
        current_balance_cents: 1_000_00,
        target_date: '2028-01-01',
        annual_interest_bps: null,
        linked_account_id: null,
      }],
      budgetLines: [{
        line_group: 'savings',
        amount_cents: 200_00,
        frequency: 'fortnightly',
        interval_count: null,
        goal_id: 'g-1',
      }],
    }),
    NOW,
  )
  assertEquals(firings, [])
})

Deno.test('goal_eta_slipped ignores an undated or already-met goal', () => {
  const firings = evaluateHousehold(
    bundle({
      savingsGoals: [
        {
          id: 'g-undated',
          name: 'Rainy day',
          target_amount_cents: 10_000_00,
          current_balance_cents: 0,
          target_date: null,
          annual_interest_bps: null,
          linked_account_id: null,
        },
        {
          id: 'g-met',
          name: 'Done',
          target_amount_cents: 1_000_00,
          current_balance_cents: 1_500_00,
          target_date: '2020-01-01',
          annual_interest_bps: null,
          linked_account_id: null,
        },
      ],
    }),
    NOW,
  )
  assertEquals(firings, [])
})

Deno.test('goal_eta_slipped reads a linked saver balance over the entered one', () => {
  const goal = {
    id: 'g-1',
    name: 'Car',
    target_amount_cents: 20_000_00,
    current_balance_cents: 0,
    target_date: '2027-08-01',
    annual_interest_bps: null,
    linked_account_id: 'acct-1',
  }
  const contributing = [{
    line_group: 'savings',
    amount_cents: 100_00,
    frequency: 'fortnightly',
    interval_count: null,
    goal_id: 'g-1',
  }]
  const slipped = evaluateHousehold(
    bundle({ savingsGoals: [goal], budgetLines: contributing }),
    NOW,
  )
  assertEquals(slipped.map((f) => f.trigger), ['goal_eta_slipped'])
  const met = evaluateHousehold(
    bundle({
      savingsGoals: [goal],
      budgetLines: contributing,
      accountBalances: [{ account_id: 'acct-1', balance_cents: 20_000_00 }],
    }),
    NOW,
  )
  assertEquals(met, [])
})

Deno.test('temporary_item_expiring fires inside the 14-day window only', () => {
  const soon = evaluateHousehold(
    bundle({
      temporaryItems: [{
        id: 't-1',
        name: 'Car rego',
        contribution_cents: 50_00,
        target_date: '2027-02-25',
      }],
    }),
    NOW,
  )
  assertEquals(soon.map((f) => f.trigger), ['temporary_item_expiring'])
  assertEquals(soon[0].dedupeKey, 't-1')

  const later = evaluateHousehold(
    bundle({
      temporaryItems: [{
        id: 't-1',
        name: 'Car rego',
        contribution_cents: 50_00,
        target_date: '2027-04-01',
      }],
    }),
    NOW,
  )
  assertEquals(later, [])
})

Deno.test('fy_boundary fires within 14 days of 30 June', () => {
  assertEquals(
    evaluateHousehold(bundle(), new Date('2027-06-20T00:00:00Z')).map((f) => f.trigger),
    [
      'fy_boundary',
    ],
  )
  assertEquals(evaluateHousehold(bundle(), new Date('2027-06-10T00:00:00Z')), [])
})

// ── helpers ────────────────────────────────────────────────────────────────

Deno.test('formatCents renders integer cents as dollars', () => {
  assertEquals(formatCents(0), '$0.00')
  assertEquals(formatCents(123_45), '$123.45')
  assertEquals(formatCents(-1_234_500), '-$12,345.00')
  assertEquals(formatCents(9), '$0.09')
})

Deno.test('daysUntil and upcomingJune30 count whole UTC days', () => {
  assertEquals(daysUntil(new Date('2027-02-15T23:00:00Z'), '2027-02-20'), 5)
  assertEquals(daysUntil(new Date('2027-07-01T00:00:00Z'), '2027-06-30'), -1)
  assertEquals(upcomingJune30(new Date('2027-03-01T00:00:00Z')), '2027-06-30')
  assertEquals(upcomingJune30(new Date('2027-08-01T00:00:00Z')), '2028-06-30')
})

// ── runNotifyEval: orchestration ───────────────────────────────────────────

function device(id: string): PushDevice {
  return { id, endpoint: `https://push.example/${id}`, p256dh: `p-${id}`, auth: `a-${id}` }
}

function subscription(id: string, memberId: string): SubscriptionRow {
  return { ...device(id), member_id: memberId }
}

/** A household whose only firing is the expiring temporary item `t-1`. */
function tempItemBundle(): HouseholdBundle {
  return bundle({
    temporaryItems: [{
      id: 't-1',
      name: 'Rego',
      contribution_cents: 50_00,
      target_date: '2027-02-20',
    }],
  })
}

interface Recorded {
  sent: Array<{ endpoint: string; payload: PushPayload }>
  logged: Array<{ memberId: string; trigger: Trigger; dedupeKey: string }>
  pruned: string[]
}

function deps(
  overrides: Partial<NotifyEvalDeps> = {},
  recorded: Recorded = { sent: [], logged: [], pruned: [] },
): { deps: NotifyEvalDeps; recorded: Recorded } {
  const base: NotifyEvalDeps = {
    now: () => NOW,
    loadHouseholdIds: () => Promise.resolve(['h-1']),
    loadBundle: () => Promise.resolve(tempItemBundle()),
    loadSubscriptions: () => Promise.resolve([subscription('d-1', 'm-1')]),
    loadPreferences: () => Promise.resolve([]),
    loadRecentLog: () => Promise.resolve([]),
    sendPush: (dev, payload): Promise<DeliveryOutcome> => {
      recorded.sent.push({ endpoint: dev.endpoint, payload })
      return Promise.resolve({ delivered: true })
    },
    prune: (ids) => {
      recorded.pruned.push(...ids)
      return Promise.resolve()
    },
    recordLog: ({ memberId, trigger, dedupeKey }) => {
      recorded.logged.push({ memberId, trigger, dedupeKey })
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps: base, recorded }
}

Deno.test('runNotifyEval sends a firing to every device and logs it once', async () => {
  const { deps: d, recorded } = deps({
    loadSubscriptions: () =>
      Promise.resolve([subscription('d-1', 'm-1'), subscription('d-2', 'm-1')]),
  })
  const summary = await runNotifyEval(d)

  assertEquals(recorded.sent.map((s) => s.endpoint), [
    'https://push.example/d-1',
    'https://push.example/d-2',
  ])
  assertEquals(recorded.logged, [{
    memberId: 'm-1',
    trigger: 'temporary_item_expiring',
    dedupeKey: 't-1',
  }])
  assertEquals(summary.notified, 1)
  assertEquals(summary.sent, 2)
  assertEquals(summary.firings, 1)
})

Deno.test('runNotifyEval skips a member who turned the trigger off', async () => {
  const prefs: PreferenceRow[] = [
    { member_id: 'm-1', trigger: 'temporary_item_expiring', enabled: false },
  ]
  const { deps: d, recorded } = deps({ loadPreferences: () => Promise.resolve(prefs) })
  const summary = await runNotifyEval(d)

  assertEquals(recorded.sent, [])
  assertEquals(recorded.logged, [])
  assertEquals(summary.skipped, 1)
})

Deno.test('runNotifyEval skips a firing already in the dedupe log', async () => {
  const log: LogRow[] = [
    {
      member_id: 'm-1',
      trigger: 'temporary_item_expiring',
      dedupe_key: 't-1',
      sent_at: '2020-01-01T00:00:00Z',
    },
  ]
  const { deps: d, recorded } = deps({ loadRecentLog: () => Promise.resolve(log) })
  const summary = await runNotifyEval(d)

  assertEquals(recorded.sent, [])
  assertEquals(summary.skipped, 1)
})

Deno.test('runNotifyEval re-notifies a stale buffer warning but not a fresh one', async () => {
  const bufferBundle = bundle({
    inflows: [],
    taxProfiles: [],
    budgetLines: [{
      line_group: 'needs',
      amount_cents: 500_00,
      frequency: 'fortnightly',
      interval_count: null,
      goal_id: null,
    }],
  })
  const fresh: LogRow[] = [
    {
      member_id: 'm-1',
      trigger: 'buffer_negative',
      dedupe_key: '2027',
      sent_at: '2027-02-10T00:00:00Z',
    },
  ]
  const stale: LogRow[] = [
    {
      member_id: 'm-1',
      trigger: 'buffer_negative',
      dedupe_key: '2027',
      sent_at: '2027-01-01T00:00:00Z',
    },
  ]

  const freshRun = deps({
    loadBundle: () => Promise.resolve(bufferBundle),
    loadRecentLog: () => Promise.resolve(fresh),
  })
  await runNotifyEval(freshRun.deps)
  assertEquals(freshRun.recorded.sent, [])

  const staleRun = deps({
    loadBundle: () => Promise.resolve(bufferBundle),
    loadRecentLog: () => Promise.resolve(stale),
  })
  await runNotifyEval(staleRun.deps)
  assertEquals(staleRun.recorded.logged, [{
    memberId: 'm-1',
    trigger: 'buffer_negative',
    dedupeKey: '2027',
  }])
})

Deno.test('runNotifyEval prunes a device the push service reports gone', async () => {
  const { deps: d, recorded } = deps({
    loadSubscriptions: () =>
      Promise.resolve([subscription('d-1', 'm-1'), subscription('d-2', 'm-1')]),
    sendPush: (dev) =>
      Promise.resolve(
        dev.id === 'd-2' ? { delivered: false, gone: true } : { delivered: true },
      ),
  })
  const summary = await runNotifyEval(d)

  assertEquals(recorded.pruned, ['d-2'])
  assertEquals(summary.pruned, 1)
  assertEquals(summary.sent, 1)
  // One device still took it, so the notification is logged.
  assertEquals(recorded.logged.length, 1)
})

Deno.test('runNotifyEval does not log when every device fails transiently', async () => {
  const { deps: d, recorded } = deps({
    sendPush: () => Promise.resolve({ delivered: false, gone: false }),
  })
  const summary = await runNotifyEval(d)

  assertEquals(recorded.logged, [])
  assertEquals(summary.failed, 1)
  assertEquals(summary.notified, 0)
})

Deno.test('runNotifyEval does nothing for a household with no devices', async () => {
  const { deps: d, recorded } = deps({ loadSubscriptions: () => Promise.resolve([]) })
  const summary = await runNotifyEval(d)

  assertEquals(recorded.sent, [])
  assertEquals(summary.firings, 1)
  assertEquals(summary.notified, 0)
})

Deno.test('runNotifyEval reports a household with no firing and moves on', async () => {
  const { deps: d, recorded } = deps({ loadBundle: () => Promise.resolve(bundle()) })
  const summary = await runNotifyEval(d)

  assertEquals(summary, {
    households: 1,
    firings: 0,
    notified: 0,
    sent: 0,
    pruned: 0,
    skipped: 0,
    failed: 0,
  })
  assertEquals(recorded.sent, [])
})
