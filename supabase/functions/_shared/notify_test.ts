import { assertEquals } from '@std/assert'
import {
  deliverFirings,
  type DeliveryDeps,
  type Firing,
  formatCents,
  type PreferenceRow,
  type Trigger,
} from './notify.ts'
import type { DeliveryOutcome } from './webpush.ts'

const NOW = new Date('2027-02-15T09:00:00Z')

function firing(trigger: Trigger = 'fy_boundary', visibleToMemberId?: string): Firing {
  return {
    trigger,
    dedupeKey: 'k-1',
    payload: { title: 'T', body: 'B', url: '/' },
    ...(visibleToMemberId && { visibleToMemberId }),
  }
}

function fakes(overrides: Partial<DeliveryDeps> = {}) {
  const sent: string[] = []
  const logged: Array<{ memberId: string; trigger: Trigger; dedupeKey: string }> = []
  const pruned: string[] = []
  const prunedApns: string[] = []
  const deps: DeliveryDeps = {
    loadSubscriptions: () =>
      Promise.resolve([
        { id: 'w-1', member_id: 'm-1', endpoint: 'e-1', p256dh: 'p', auth: 'a' },
        { id: 'w-2', member_id: 'm-2', endpoint: 'e-2', p256dh: 'p', auth: 'a' },
      ]),
    loadApnsDevices: () =>
      Promise.resolve([{ id: 'i-1', member_id: 'm-1', token: 't-1', environment: 'production' }]),
    loadPreferences: () => Promise.resolve([]),
    loadRecentLog: () => Promise.resolve([]),
    sendPush: (device): Promise<DeliveryOutcome> => {
      sent.push(device.id)
      return Promise.resolve({ delivered: true })
    },
    sendApns: (device): Promise<DeliveryOutcome> => {
      sent.push(device.id)
      return Promise.resolve({ delivered: true })
    },
    prune: (ids) => {
      pruned.push(...ids)
      return Promise.resolve()
    },
    pruneApns: (ids) => {
      prunedApns.push(...ids)
      return Promise.resolve()
    },
    recordLog: ({ memberId, trigger, dedupeKey }) => {
      logged.push({ memberId, trigger, dedupeKey })
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps, sent, logged, pruned, prunedApns }
}

Deno.test('deliverFirings sends to every device of every member and logs once per member', async () => {
  const { deps, sent, logged } = fakes()
  const summary = await deliverFirings(deps, 'h-1', [firing()], NOW)
  assertEquals(sent, ['w-1', 'i-1', 'w-2'])
  assertEquals(logged.map((row) => row.memberId), ['m-1', 'm-2'])
  assertEquals(summary, { notified: 2, sent: 3, pruned: 0, skipped: 0, failed: 0 })
})

Deno.test('deliverFirings restricts a visibleToMemberId firing to that member', async () => {
  const { deps, sent } = fakes()
  await deliverFirings(deps, 'h-1', [firing('fy_boundary', 'm-2')], NOW)
  assertEquals(sent, ['w-2'])
})

Deno.test('deliverFirings holds transaction_review off for a member with no preference row', async () => {
  const preferences: PreferenceRow[] = [
    { member_id: 'm-2', trigger: 'transaction_review', enabled: true },
  ]
  const { deps, sent } = fakes({ loadPreferences: () => Promise.resolve(preferences) })
  const summary = await deliverFirings(deps, 'h-1', [firing('transaction_review')], NOW)
  assertEquals(sent, ['w-2'])
  assertEquals(summary.skipped, 1)
})

Deno.test('deliverFirings skips a trigger turned off and one already logged', async () => {
  const { deps, sent } = fakes({
    loadPreferences: () =>
      Promise.resolve([{ member_id: 'm-1', trigger: 'fy_boundary', enabled: false }]),
    loadRecentLog: () =>
      Promise.resolve([{
        member_id: 'm-2',
        trigger: 'fy_boundary',
        dedupe_key: 'k-1',
        sent_at: '2027-02-01T00:00:00Z',
      }]),
  })
  const summary = await deliverFirings(deps, 'h-1', [firing()], NOW)
  assertEquals(sent, [])
  assertEquals(summary.skipped, 2)
})

Deno.test('deliverFirings prunes dead devices and does not log a transient failure', async () => {
  const { deps, logged, pruned, prunedApns } = fakes({
    sendPush: (device) =>
      Promise.resolve(
        device.id === 'w-1' ? { delivered: false, gone: true } : { delivered: false, gone: false },
      ),
    sendApns: () => Promise.resolve({ delivered: false, gone: true }),
  })
  const summary = await deliverFirings(deps, 'h-1', [firing()], NOW)
  assertEquals(pruned, ['w-1'])
  assertEquals(prunedApns, ['i-1'])
  assertEquals(logged, [])
  assertEquals(summary, { notified: 0, sent: 0, pruned: 2, skipped: 0, failed: 1 })
})

Deno.test('deliverFirings reads no devices when nothing fired', async () => {
  let reads = 0
  const { deps } = fakes({
    loadSubscriptions: () => {
      reads += 1
      return Promise.resolve([])
    },
  })
  await deliverFirings(deps, 'h-1', [], NOW)
  assertEquals(reads, 0)
})

Deno.test('formatCents renders integer cents as dollars', () => {
  assertEquals(formatCents(0), '$0.00')
  assertEquals(formatCents(123_45), '$123.45')
  assertEquals(formatCents(-1_234_500), '-$12,345.00')
  assertEquals(formatCents(9), '$0.09')
})
