import { assertEquals } from '@std/assert'
import { RedbarkApiError } from './redbark.ts'
import { redbarkFailure } from './redbarkFailure.ts'

function failure(error: unknown) {
  const original = console.error
  const logged: unknown[][] = []
  console.error = (...args: unknown[]) => void logged.push(args)
  try {
    return { result: redbarkFailure(error, 'test step'), logged }
  } finally {
    console.error = original
  }
}

Deno.test('redbarkFailure maps a plan without API access to 503', () => {
  const { result } = failure(new RedbarkApiError(403, 'plan_upgrade_required', 'secret detail'))
  assertEquals(result.status, 503)
  assertEquals(result.body.code, 'plan_upgrade_required')
})

Deno.test('redbarkFailure maps a rejected key to 500', () => {
  for (const status of [401, 403]) {
    const { result } = failure(new RedbarkApiError(status, 'invalid_api_key', 'secret detail'))
    assertEquals(result.status, 500)
    assertEquals(result.body.code, 'redbark_auth_failed')
  }
})

Deno.test('redbarkFailure maps anything else to 502', () => {
  for (const error of [new RedbarkApiError(500, null, 'secret detail'), new Error('down'), 'x']) {
    const { result } = failure(error)
    assertEquals(result.status, 502)
    assertEquals(result.body.code, 'redbark_unavailable')
  }
})

Deno.test('redbarkFailure logs upstream detail but never returns it', () => {
  const error = new RedbarkApiError(500, 'oops', 'Redbark API 500: req_123 secret detail')
  const { result, logged } = failure(error)
  assertEquals(JSON.stringify(result).includes('req_123'), false)
  assertEquals(logged, [['Redbark test step failed:', error]])
})
