import { assertEquals } from '@std/assert'
import { type PushDevice, type PushTestDeps, runPushTest, TEST_PAYLOAD } from './send.ts'

function device(id: string): PushDevice {
  return { id, endpoint: `https://push.example/${id}`, p256dh: `p-${id}`, auth: `a-${id}` }
}

/** Default happy-path deps over two devices, overridable per test. */
function deps(overrides: Partial<PushTestDeps> = {}): PushTestDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    loadDevices: () => Promise.resolve([device('d-1'), device('d-2')]),
    loadSender: () => Promise.resolve(() => Promise.resolve({ delivered: true })),
    prune: () => Promise.resolve(true),
    loadApnsDevices: () => Promise.resolve([]),
    loadApnsSender: () => Promise.resolve(() => Promise.resolve({ delivered: true })),
    pruneApns: () => Promise.resolve(true),
    ...overrides,
  }
}

Deno.test("runPushTest sends the test payload to each of the caller's devices", async () => {
  const seen: Array<[string, string]> = []
  const result = await runPushTest(
    deps({
      loadSender: () =>
        Promise.resolve((d, payload) => {
          seen.push([d.endpoint, payload.title])
          return Promise.resolve({ delivered: true })
        }),
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 2, sent: 2, pruned: 0, failed: 0 } })
  assertEquals(seen, [
    ['https://push.example/d-1', TEST_PAYLOAD.title],
    ['https://push.example/d-2', TEST_PAYLOAD.title],
  ])
})

Deno.test("runPushTest loads only the resolved member's devices", async () => {
  const asked: string[] = []
  await runPushTest(
    deps({
      loadDevices: (memberId) => {
        asked.push(memberId)
        return Promise.resolve([device('d-1')])
      },
    }),
  )
  assertEquals(asked, ['m-1'])
})

Deno.test('runPushTest prunes a subscription the push service reports gone', async () => {
  const pruned: string[][] = []
  const result = await runPushTest(
    deps({
      loadSender: () =>
        Promise.resolve((d) =>
          Promise.resolve(
            d.id === 'd-2' ? { delivered: false, gone: true } : { delivered: true },
          )
        ),
      prune: (ids) => {
        pruned.push(ids)
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 2, sent: 1, pruned: 1, failed: 0 } })
  assertEquals(pruned, [['d-2']])
})

Deno.test('runPushTest does not prune on a transient failure', async () => {
  const pruned: string[][] = []
  const result = await runPushTest(
    deps({
      loadSender: () =>
        Promise.resolve((d) =>
          Promise.resolve(
            d.id === 'd-2' ? { delivered: false, gone: false } : { delivered: true },
          )
        ),
      prune: (ids) => {
        pruned.push(ids)
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 2, sent: 1, pruned: 0, failed: 1 } })
  assertEquals(pruned, [])
})

Deno.test('runPushTest reports the reason an unreachable device failed', async () => {
  const result = await runPushTest(
    deps({
      loadSender: () =>
        Promise.resolve(() =>
          Promise.resolve({ delivered: false, gone: false, reason: 'ExpiredProviderToken' })
        ),
    }),
  )
  assertEquals(result, {
    status: 200,
    body: {
      devices: 2,
      sent: 0,
      pruned: 0,
      failed: 2,
      failures: [
        { channel: 'web', reason: 'ExpiredProviderToken' },
        { channel: 'web', reason: 'ExpiredProviderToken' },
      ],
    },
  })
})

Deno.test('runPushTest keeps sending after one device throws', async () => {
  const attempted: string[] = []
  const result = await runPushTest(
    deps({
      loadSender: () =>
        Promise.resolve((d) => {
          attempted.push(d.id)
          if (d.id === 'd-1') throw new Error('socket hang up')
          return Promise.resolve({ delivered: true })
        }),
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 2, sent: 1, pruned: 0, failed: 1 } })
  assertEquals(attempted, ['d-1', 'd-2'])
})

Deno.test('runPushTest counts a failed prune as a failure, not a prune', async () => {
  const result = await runPushTest(
    deps({
      loadSender: () => Promise.resolve(() => Promise.resolve({ delivered: false, gone: true })),
      prune: () => Promise.resolve(false),
    }),
  )
  assertEquals(result, { status: 200, body: { devices: 2, sent: 0, pruned: 0, failed: 2 } })
})

Deno.test('runPushTest reports no devices without asking for keys', async () => {
  let senders = 0
  const result = await runPushTest(
    deps({
      loadDevices: () => Promise.resolve([]),
      loadSender: () => {
        senders += 1
        return Promise.resolve(() => Promise.resolve({ delivered: true }))
      },
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 0, sent: 0, pruned: 0, failed: 0 } })
  assertEquals(senders, 0)
})

Deno.test('runPushTest reports unconfigured VAPID keys', async () => {
  const result = await runPushTest(deps({ loadSender: () => Promise.resolve(null) }))
  assertEquals(result, {
    status: 503,
    body: { error: 'Push notifications are not configured.' },
  })
})

Deno.test('runPushTest reports a device-read failure', async () => {
  const result = await runPushTest(deps({ loadDevices: () => Promise.resolve(null) }))
  assertEquals(result, { status: 500, body: { error: 'Could not load your devices.' } })
})

Deno.test('runPushTest refuses an unauthenticated caller', async () => {
  let reads = 0
  const result = await runPushTest(
    deps({
      resolveMember: () =>
        Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
      loadDevices: () => {
        reads += 1
        return Promise.resolve([])
      },
    }),
  )

  assertEquals(result, { status: 401, body: { error: 'Invalid authorization' } })
  assertEquals(reads, 0)
})

Deno.test('runPushTest targets the household tab for notificationclick', () => {
  assertEquals(TEST_PAYLOAD.url, '/household')
})

Deno.test('runPushTest sends to APNs devices alongside Web Push ones', async () => {
  const seen: string[] = []
  const result = await runPushTest(
    deps({
      loadApnsDevices: () =>
        Promise.resolve([{ id: 'a-1', token: 'tok', environment: 'sandbox' as const }]),
      loadApnsSender: () =>
        Promise.resolve((d, payload) => {
          seen.push(`${d.token}:${payload.title}`)
          return Promise.resolve({ delivered: true })
        }),
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 3, sent: 3, pruned: 0, failed: 0 } })
  assertEquals(seen, [`tok:${TEST_PAYLOAD.title}`])
})

Deno.test('runPushTest reaches a member with only an APNs device without VAPID keys', async () => {
  let webSenders = 0
  const result = await runPushTest(
    deps({
      loadDevices: () => Promise.resolve([]),
      loadSender: () => {
        webSenders += 1
        return Promise.resolve(null)
      },
      loadApnsDevices: () =>
        Promise.resolve([{ id: 'a-1', token: 'tok', environment: 'production' as const }]),
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 1, sent: 1, pruned: 0, failed: 0 } })
  assertEquals(webSenders, 0)
})

Deno.test('runPushTest prunes a dead APNs device from the APNs table', async () => {
  const pruned: { web: string[][]; apns: string[][] } = { web: [], apns: [] }
  const result = await runPushTest(
    deps({
      loadApnsDevices: () =>
        Promise.resolve([{ id: 'a-1', token: 'tok', environment: 'production' as const }]),
      loadApnsSender: () =>
        Promise.resolve(() => Promise.resolve({ delivered: false, gone: true })),
      prune: (ids) => {
        pruned.web.push(ids)
        return Promise.resolve(true)
      },
      pruneApns: (ids) => {
        pruned.apns.push(ids)
        return Promise.resolve(true)
      },
    }),
  )

  assertEquals(result, { status: 200, body: { devices: 3, sent: 2, pruned: 1, failed: 0 } })
  assertEquals(pruned, { web: [], apns: [['a-1']] })
})

Deno.test('runPushTest counts devices of an unconfigured kind as failed, not a 503', async () => {
  const result = await runPushTest(
    deps({
      loadApnsDevices: () =>
        Promise.resolve([{ id: 'a-1', token: 'tok', environment: 'production' as const }]),
      loadApnsSender: () => Promise.resolve(null),
    }),
  )
  assertEquals(result, { status: 200, body: { devices: 3, sent: 2, pruned: 0, failed: 1 } })
})

Deno.test('runPushTest reports an APNs-read failure', async () => {
  const result = await runPushTest(deps({ loadApnsDevices: () => Promise.resolve(null) }))
  assertEquals(result, { status: 500, body: { error: 'Could not load your devices.' } })
})
