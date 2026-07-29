import { assertEquals } from '@std/assert'
import { type RawPayslipFields } from './fields.ts'
import { type ExtractDeps, householdSegment, normalisePath, runExtract } from './extract.ts'
import { MAX_IMAGE_BYTES, PAYSLIP_MODEL } from './model.ts'

const HOUSEHOLD = 'hh-1'
const PATH = `${HOUSEHOLD}/2026/payslip.pdf`

/** Reported fields for a slip with everything on it, overridable per test. */
function fields(overrides: Partial<RawPayslipFields> = {}): RawPayslipFields {
  return {
    is_payslip: true,
    not_payslip_reason: null,
    period_start: '2026-07-06',
    period_end: '2026-07-19',
    paid_on: '2026-07-22',
    gross: '4,120.50',
    tax_withheld: '1,048.00',
    super: '473.86',
    net: '3,072.50',
    salary_sacrifice: null,
    ytd_gross: '12,361.50',
    ytd_tax_withheld: '3,144.00',
    ytd_super: '1,421.58',
    earnings_lines: [],
    tax_lines: [],
    ...overrides,
  }
}

/**
 * Default happy-path deps, overridable per test. `calls` records every dependency
 * the flow reaches, so a test can assert both the ordering and that nothing was
 * touched after a failure.
 */
function deps(overrides: Partial<ExtractDeps> = {}): ExtractDeps & { calls: string[] } {
  const calls: string[] = []
  // Records the call, then delegates to the override or the happy-path default,
  // so an overridden dependency still shows up in `calls`.
  const wrap = <T extends (...args: never[]) => unknown>(
    name: string,
    fallback: T,
  ): T => (((...args: never[]) => {
    calls.push(name)
    return (overrides[name as keyof ExtractDeps] as T | undefined ?? fallback)(...args)
  }) as T)

  return {
    calls,
    resolveHousehold: wrap('resolveHousehold', () => Promise.resolve({ householdId: HOUSEHOLD })),
    apiKey: wrap('apiKey', () => Promise.resolve('sk-ant-test')),
    downloadObject: wrap(
      'downloadObject',
      () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' }),
    ),
    extract: wrap('extract', () => Promise.resolve({ ok: true as const, fields: fields() })),
  }
}

Deno.test('normalisePath accepts a household-prefixed object path', () => {
  assertEquals(normalisePath(PATH), PATH)
  assertEquals(normalisePath(`  ${PATH}  `), PATH)
  assertEquals(householdSegment(PATH), HOUSEHOLD)
})

Deno.test('normalisePath rejects an absent, rooted, or traversing path', () => {
  assertEquals(normalisePath(undefined), '')
  assertEquals(normalisePath(''), '')
  assertEquals(normalisePath(42), '')
  assertEquals(normalisePath('payslip.pdf'), '') // No household prefix.
  assertEquals(normalisePath(`/${PATH}`), '')
  assertEquals(normalisePath(`${HOUSEHOLD}/../hh-2/payslip.pdf`), '')
  assertEquals(normalisePath(`${HOUSEHOLD}//payslip.pdf`), '')
})

Deno.test('runExtract returns the fields as integer cents alongside what was read', async () => {
  const result = await runExtract(PATH, deps())

  assertEquals(result.status, 200)
  const body = result.body as Record<string, Record<string, unknown> | unknown>
  assertEquals(body.model, PAYSLIP_MODEL)
  assertEquals((body.fields as Record<string, unknown>).gross_cents, 412050)
  assertEquals((body.fields as Record<string, unknown>).tax_withheld_cents, 104800)
  assertEquals((body.fields as Record<string, unknown>).period_start, '2026-07-06')
  assertEquals((body.text as Record<string, unknown>).gross, '4,120.50')
  assertEquals(body.missing, ['salary_sacrifice_cents'])
  assertEquals(body.unreadable, [])
})

Deno.test('runExtract threads the Vault key to the model and reads the object once', async () => {
  const seen: string[] = []
  const d = deps({
    extract: (_file, apiKey) => {
      seen.push(apiKey)
      return Promise.resolve({ ok: true as const, fields: fields() })
    },
  })
  await runExtract(PATH, d)

  assertEquals(seen, ['sk-ant-test'])
  assertEquals(d.calls, ['resolveHousehold', 'apiKey', 'downloadObject', 'extract'])
})

Deno.test('runExtract succeeds on a partial slip, reporting every null field', async () => {
  const empty = fields({
    period_start: null,
    period_end: null,
    paid_on: null,
    gross: null,
    tax_withheld: null,
    super: null,
    net: null,
    ytd_gross: null,
    ytd_tax_withheld: null,
    ytd_super: null,
  })
  const result = await runExtract(
    PATH,
    deps({ extract: () => Promise.resolve({ ok: true as const, fields: empty }) }),
  )

  assertEquals(result.status, 200)
  const body = result.body as Record<string, unknown>
  assertEquals(Object.values(body.fields as Record<string, unknown>).every((v) => v === null), true)
  assertEquals((body.missing as string[]).length, 11)
})

Deno.test('runExtract rejects a path outside the caller household before reading anything', async () => {
  const d = deps()
  const result = await runExtract('hh-2/2026/payslip.pdf', d)

  assertEquals(result.status, 403)
  assertEquals(d.calls, ['resolveHousehold'])
})

Deno.test('runExtract rejects a missing path before resolving the caller', async () => {
  const d = deps()
  const result = await runExtract(undefined, d)

  assertEquals(result.status, 400)
  assertEquals(d.calls, [])
})

Deno.test('runExtract surfaces a caller-resolution error', async () => {
  const result = await runExtract(
    PATH,
    deps({
      resolveHousehold: () => Promise.resolve({ error: { status: 401, message: 'nope' } }),
    }),
  )

  assertEquals(result, { status: 401, body: { error: 'nope' } })
})

Deno.test('runExtract degrades to manual entry when the API key is unset', async () => {
  const d = deps({ apiKey: () => Promise.resolve(null) })
  const result = await runExtract(PATH, d)

  assertEquals(result.status, 503)
  const body = result.body as Record<string, unknown>
  assertEquals(body.configured, false)
  assertEquals(
    body.error,
    'Payslip extraction is not configured. Enter the figures by hand.',
  )
  // The three "switched off" outcomes never carry each other's flag: the operator
  // sets a Vault secret for this one, tops an account up for the second, and
  // rotates the secret for the third.
  assertEquals(body.outOfCredit, undefined)
  assertEquals(body.keyRejected, undefined)
  // Nothing is downloaded or sent when the feature is not configured.
  assertEquals(d.calls, ['resolveHousehold', 'apiKey'])
})

Deno.test('runExtract reports an exhausted credit balance as reading being off, not broken', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'no_credit' as const,
          message: '400 Your credit balance is too low to access the Anthropic API.',
          status: 400,
        }),
    }),
  )

  assertEquals(result.status, 503)
  const body = result.body as Record<string, unknown>
  assertEquals(body.outOfCredit, true)
  // Not either other switched-off flag: the fix is an operator topping up, not
  // setting a key for the first time or rotating one the API refuses.
  assertEquals(body.configured, undefined)
  assertEquals(body.keyRejected, undefined)
  const error = String(body.error)
  assertEquals(error.includes('topped up'), true)
  assertEquals(error.includes('Nothing is wrong with your file'), true)
  // No retry is offered, because no retry can succeed.
  assertEquals(error.toLowerCase().includes('try again'), false)
})

Deno.test('runExtract reports a refused key as reading being off, not broken', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'key_rejected' as const,
          message: '401 invalid x-api-key',
          status: 401,
        }),
    }),
  )

  assertEquals(result.status, 503)
  const body = result.body as Record<string, unknown>
  assertEquals(body.keyRejected, true)
  // Neither of the other two switched-off flags: this key is rotated, not set for
  // the first time, and the account behind it is funded.
  assertEquals(body.configured, undefined)
  assertEquals(body.outOfCredit, undefined)
  const error = String(body.error)
  assertEquals(error.includes('API key is fixed'), true)
  assertEquals(error.includes('Nothing is wrong with your file'), true)
  // No retry is offered: the same key would be refused identically.
  assertEquals(error.toLowerCase().includes('try again'), false)
})

Deno.test('runExtract reports a file that is not in the bucket', async () => {
  const d = deps({ downloadObject: () => Promise.resolve(null) })
  const result = await runExtract(PATH, d)

  assertEquals(result.status, 404)
  assertEquals(d.calls, ['resolveHousehold', 'apiKey', 'downloadObject'])
})

Deno.test('runExtract rejects an empty file', async () => {
  const result = await runExtract(
    PATH,
    deps({
      downloadObject: () =>
        Promise.resolve({ bytes: new Uint8Array(), contentType: 'application/pdf' }),
    }),
  )

  assertEquals(result.status, 400)
  assertEquals((result.body as Record<string, unknown>).error, 'That payslip file is empty.')
})

Deno.test('runExtract rejects an unsupported file type with the types it takes', async () => {
  const d = deps({
    downloadObject: () =>
      Promise.resolve({ bytes: new Uint8Array([1]), contentType: 'image/heic' }),
  })
  const result = await runExtract(`${HOUSEHOLD}/slip.heic`, d)

  assertEquals(result.status, 415)
  const error = (result.body as Record<string, string>).error
  assertEquals(error.includes('PDF, JPEG, PNG, or WebP'), true)
  assertEquals(error.includes('application/pdf'), true)
  assertEquals(d.calls, ['resolveHousehold', 'apiKey', 'downloadObject'])
})

Deno.test('runExtract rejects an oversized file with its size and the limit', async () => {
  const d = deps({
    downloadObject: () =>
      Promise.resolve({
        bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
        contentType: 'image/jpeg',
      }),
  })
  const result = await runExtract(`${HOUSEHOLD}/slip.jpg`, d)

  assertEquals(result.status, 413)
  const error = (result.body as Record<string, string>).error
  assertEquals(error.includes('too large'), true)
  assertEquals(error.includes('5.0 MB'), true)
  // The oversized file is never sent, so the request cannot be truncated upstream.
  assertEquals(d.calls, ['resolveHousehold', 'apiKey', 'downloadObject'])
})

Deno.test('runExtract reports a document the model says is not a payslip', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: true as const,
          fields: fields({ is_payslip: false, not_payslip_reason: 'A bank statement.' }),
        }),
    }),
  )

  assertEquals(result.status, 422)
  assertEquals(result.body, {
    error: 'That file does not look like a payslip.',
    notPayslip: true,
    reason: 'A bank statement.',
  })
})

Deno.test('runExtract turns malformed model output into a clean error', async () => {
  const d = deps({
    extract: () =>
      Promise.resolve({
        ok: false as const,
        failure: 'malformed' as const,
        message: 'The model returned unreadable fields.',
      }),
  })
  const result = await runExtract(PATH, d)

  assertEquals(result.status, 502)
  assertEquals(
    (result.body as Record<string, unknown>).error,
    'The payslip could not be read. Enter the figures by hand.',
  )
  assertEquals(d.calls, ['resolveHousehold', 'apiKey', 'downloadObject', 'extract'])
})

Deno.test('runExtract reports a model refusal as a content problem, not a server error', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'refused' as const,
          message: 'The model declined to read that file.',
        }),
    }),
  )

  assertEquals(result.status, 422)
  assertEquals(
    (result.body as Record<string, unknown>).error,
    'That file could not be read. Enter the figures by hand.',
  )
})

Deno.test('runExtract maps a model API failure to a bad gateway, offering a retry when one could work', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'api_error' as const,
          message: 'overloaded',
          status: 529,
        }),
    }),
  )

  assertEquals(result.status, 502)
  assertEquals(
    (result.body as Record<string, unknown>).error,
    'The payslip could not be read right now. Try again, or enter it by hand.',
  )
})

Deno.test('runExtract still reads an unrelated bad request as a server fault, with no retry', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'api_error' as const,
          message: '400 messages.0.content.1: unexpected block',
          status: 400,
        }),
    }),
  )

  // A malformed request is the server's fault, not a billing problem, and it
  // would be rejected identically on a retry, so none is invited.
  assertEquals(result.status, 502)
  assertEquals(
    (result.body as Record<string, unknown>).error,
    'The payslip could not be read. Enter the figures by hand.',
  )
})

Deno.test('runExtract passes an upstream rate limit through so the client can back off', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'api_error' as const,
          message: 'rate limited',
          status: 429,
        }),
    }),
  )

  assertEquals(result.status, 429)
})

Deno.test('runExtract maps a model timeout to a gateway timeout', async () => {
  const result = await runExtract(
    PATH,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false as const,
          failure: 'timeout' as const,
          message: 'The model did not answer in time.',
        }),
    }),
  )

  assertEquals(result.status, 504)
  assertEquals(
    (result.body as Record<string, unknown>).error,
    'Reading the payslip took too long. Try again, or enter it by hand.',
  )
})
