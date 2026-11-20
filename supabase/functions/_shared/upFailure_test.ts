import { assertEquals } from '@std/assert'
import { UpApiError } from './up.ts'
import { UP_FAILURES, upFailure, upFailureResponse } from './upFailure.ts'

function failure(error: unknown) {
  const original = console.error
  const logged: unknown[][] = []
  console.error = (...args: unknown[]) => void logged.push(args)
  try {
    return { result: upFailure(error, 'test step'), logged }
  } finally {
    console.error = original
  }
}

Deno.test('upFailure maps each Up status to its code and status', () => {
  const cases: [number, string, number][] = [
    [401, 'up_auth_failed', 409],
    [403, 'up_auth_failed', 409],
    [429, 'up_rate_limited', 429],
    [404, 'up_transaction_not_found', 404],
    [400, 'up_rejected', 422],
    [422, 'up_rejected', 422],
    [500, 'up_unavailable', 502],
  ]
  for (const [upStatus, code, status] of cases) {
    const { result } = failure(new UpApiError(upStatus, '/transactions/x', 'secret detail'))
    assertEquals(result.body.code, code)
    assertEquals(result.status, status)
  }
})

Deno.test('upFailure maps a network failure to up_unavailable', () => {
  const { result } = failure(new TypeError('fetch failed'))
  assertEquals(result.body.code, 'up_unavailable')
  assertEquals(result.status, 502)
})

Deno.test('upFailure never relays the upstream body, and logs it', () => {
  const { result, logged } = failure(new UpApiError(422, '/transactions/x', 'secret detail'))
  assertEquals(result.body.error, UP_FAILURES.up_rejected.error)
  assertEquals(JSON.stringify(result).includes('secret detail'), false)
  assertEquals(logged.length, 1)
})

Deno.test('upFailureResponse answers a missing token with fixed copy', () => {
  assertEquals(upFailureResponse('up_not_connected'), {
    status: 409,
    body: { code: 'up_not_connected', error: UP_FAILURES.up_not_connected.error },
  })
})
