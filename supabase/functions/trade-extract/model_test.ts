import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  anthropicExtractor,
  buildSystemPrompt,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  maxBytesFor,
  resolveMediaType,
  TRADE_MODEL,
  TRADES_TOOL,
} from './model.ts'

/** A Messages API response carrying `input` as the forced tool's call. */
function toolResponse(input: unknown, stopReason = 'tool_use'): Response {
  return Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: TRADE_MODEL,
    content: [{ type: 'tool_use', id: 'toolu_test', name: TRADES_TOOL.name, input }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 40 },
  })
}

/** A stub transport that records the requests it is given. */
function stub(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const requests: Record<string, unknown>[] = []
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    requests.push(body)
    return await respond(body)
  }) as unknown as typeof fetch
  return { requests, fetchImpl }
}

const DOCUMENT = {
  is_trade_document: true,
  trades: [{
    ticker: 'VAS',
    side: 'buy',
    trade_date: '2026-07-06',
    units: '10.5',
    price_per_unit: '98.50',
    brokerage_fee: '9.50',
  }],
}

/** FY2026 runs 1 July 2025 – 30 June 2026. */
const FINANCIAL_YEAR = 2026

const PDF = { mediaType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) } as const

Deno.test('the extractor sends a PDF as a document block against the pinned model', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(DOCUMENT))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(result.ok, true)
  assertEquals(result.ok && result.document.trades[0].units, '10.5')

  const [body] = requests
  assertEquals(body.model, TRADE_MODEL)
  assertEquals(body.tool_choice, { type: 'tool', name: 'record_trades' })
  assertEquals((body.tools as { name: string }[])[0].name, 'record_trades')

  const content = body.messages as { content: Record<string, unknown>[] }[]
  const [file, instruction] = content[0].content
  assertEquals(file.type, 'document')
  assertEquals(file.source, { type: 'base64', media_type: 'application/pdf', data: 'AQID' })
  // The file comes before the instruction, as the vision guidance recommends.
  assertEquals(instruction.type, 'text')
})

Deno.test('the extractor sends a photographed document as an image block', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(DOCUMENT))
  await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'image/jpeg',
    bytes: new Uint8Array([255, 216, 255]),
  }, FINANCIAL_YEAR)

  const content = (requests[0].messages as { content: Record<string, unknown>[] }[])[0].content
  assertEquals(content[0].type, 'image')
  assertEquals((content[0].source as Record<string, unknown>).media_type, 'image/jpeg')
})

Deno.test('the system prompt keeps the model reporting printed text, not maths', () => {
  const system = buildSystemPrompt(FINANCIAL_YEAR)

  assertStringIncludes(system, 'literal text printed')
  assertStringIncludes(system, 'never the trade total')
  assertStringIncludes(system, 'never dividends')
  assertStringIncludes(system, 'one entry per trade')
})

Deno.test('the system prompt states the financial year window a yearless date resolves within', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(DOCUMENT))
  await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  const system = String(requests[0].system)
  assertStringIncludes(system, '2025-07-01')
  assertStringIncludes(system, '2026-06-30')
  assertStringIncludes(system, 'without a year')
})

Deno.test('the tool schema takes a list of trades, each field nullable and required', () => {
  const schema = TRADES_TOOL.input_schema as {
    properties: {
      trades: {
        items: {
          properties: Record<string, { anyOf?: { type: string }[] }>
          required: string[]
        }
      }
    }
    required: string[]
  }
  const item = schema.properties.trades.items

  assertEquals(Object.keys(item.properties), [
    'ticker',
    'side',
    'trade_date',
    'units',
    'price_per_unit',
    'brokerage_fee',
  ])
  assertEquals(
    Object.values(item.properties).every((property) =>
      property.anyOf?.some((option) => option.type === 'null')
    ),
    true,
  )
  // Required-but-nullable: the model must answer for every field, and "not on the
  // document" is a valid answer.
  assertEquals(item.required.length, 6)
  assertEquals(schema.required, ['is_trade_document', 'trades'])
})

Deno.test('the extractor reports a response with no extraction as malformed', async () => {
  const { fetchImpl } = stub(() =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: TRADE_MODEL,
      content: [{ type: 'text', text: 'You bought 10 VAS.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 20 },
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'malformed')
})

Deno.test('the extractor reports a refusal as its own failure', async () => {
  const { fetchImpl } = stub(() =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: TRADE_MODEL,
      content: [],
      stop_reason: 'refusal',
      stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 0 },
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'refused')
})

Deno.test('the extractor reads a cut-off answer as malformed rather than a shorter list', async () => {
  const { fetchImpl } = stub(() => toolResponse(DOCUMENT, 'max_tokens'))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'malformed')
})

Deno.test('the extractor reports an unusable tool input as malformed', async () => {
  const { fetchImpl } = stub(() => toolResponse({ trades: [] })) // No is_trade_document.
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'malformed')
})

/** An Anthropic error body of the given type and message. */
function apiError(type: string, message: string, status: number): Response {
  return Response.json({ type: 'error', error: { type, message } }, { status })
}

Deno.test('the extractor surfaces an API error with its status', async () => {
  const { fetchImpl } = stub(() => apiError('invalid_request_error', 'bad request', 400))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  // A genuinely malformed request carries the same status and type as an
  // exhausted balance, so this is the case the credit match must not swallow.
  assertEquals(!result.ok && result.failure, 'api_error')
  assertEquals(!result.ok && result.status, 400)
})

Deno.test('the extractor reads an exhausted credit balance as its own failure', async () => {
  const { fetchImpl } = stub(() =>
    apiError('invalid_request_error', 'Your credit balance is too low to access the API.', 400)
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'no_credit')
})

Deno.test('the extractor reads a billing error as an empty account whatever its status', async () => {
  const { fetchImpl } = stub(() => apiError('billing_error', 'billing is not in order', 403))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'no_credit')
})

Deno.test('the extractor reads a refused key as its own failure', async () => {
  const { fetchImpl } = stub(() => apiError('authentication_error', 'invalid x-api-key', 401))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'key_rejected')
})

Deno.test('the extractor reads a key without permission as the same refused key', async () => {
  const { fetchImpl } = stub(() => apiError('permission_error', 'not permitted', 403))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'key_rejected')
})

Deno.test('the extractor keeps a 401 carrying no API verdict out of the refused-key case', async () => {
  const { fetchImpl } = stub(() => apiError('api_error', 'proxy says no', 401))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'api_error')
})

Deno.test('the extractor surfaces a rate limit with its status', async () => {
  const { fetchImpl } = stub(() => apiError('rate_limit_error', 'slow down', 429))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)

  assertEquals(!result.ok && result.failure, 'api_error')
  assertEquals(!result.ok && result.status, 429)
})

Deno.test('the extractor logs the upstream detail and reports only its own wording', async () => {
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void logged.push(args)
  try {
    const { fetchImpl } = stub(() => apiError('api_error', 'upstream secret detail', 500))
    const apiResult = await anthropicExtractor('sk-ant-test', fetchImpl)(PDF, FINANCIAL_YEAR)
    const transport = (() =>
      Promise.reject(new TypeError('socket detail'))) as unknown as typeof fetch
    const transportResult = await anthropicExtractor('sk-ant-test', transport)(PDF, FINANCIAL_YEAR)

    assertEquals(!apiResult.ok && apiResult.message, 'The model API returned an error.')
    assertEquals(!transportResult.ok && transportResult.message, 'The model API returned an error.')
    assertEquals(logged.length >= 2, true)
    assertStringIncludes(String(logged[0]![1]), 'upstream secret detail')
    assertEquals(logged[1]![1] instanceof Error, true)
  } finally {
    console.error = original
  }
})

Deno.test('resolveMediaType prefers the recorded content type, then the extension', () => {
  assertEquals(resolveMediaType('application/pdf', 'hh/note.pdf'), 'application/pdf')
  assertEquals(resolveMediaType('image/jpeg; charset=binary', 'hh/note'), 'image/jpeg')
  assertEquals(resolveMediaType('application/octet-stream', 'hh/note.JPG'), 'image/jpeg')
  assertEquals(resolveMediaType(null, 'hh/note.webp'), 'image/webp')
})

Deno.test('resolveMediaType rejects anything the model cannot read', () => {
  assertEquals(resolveMediaType('image/heic', 'hh/note.heic'), null)
  assertEquals(resolveMediaType(null, 'hh/note'), null)
})

Deno.test('maxBytesFor caps PDFs and images separately', () => {
  assertEquals(maxBytesFor('application/pdf'), MAX_PDF_BYTES)
  assertEquals(maxBytesFor('image/png'), MAX_IMAGE_BYTES)
})
