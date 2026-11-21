import { describe, expect, it } from 'vitest'
import { functionFailureCode } from './functionFailure'

function failure(context: unknown) {
  return Object.assign(new Error('failed'), { context })
}

describe('functionFailureCode', () => {
  it('reads the code from the response body', async () => {
    const response = new Response(JSON.stringify({ code: 'up_rate_limited', error: 'x' }))
    expect(await functionFailureCode(failure(response))).toBe('up_rate_limited')
  })

  it('is null without a response, a code, or a JSON body', async () => {
    expect(await functionFailureCode(failure(undefined))).toBeNull()
    expect(
      await functionFailureCode(failure(new Response(JSON.stringify({ error: 'x' })))),
    ).toBeNull()
    expect(await functionFailureCode(failure(new Response('not json')))).toBeNull()
  })
})
