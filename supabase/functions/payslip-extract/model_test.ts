import { assertEquals, assertStringIncludes } from '@std/assert'
import { toExtraction } from './fields.ts'
import {
  anthropicExtractor,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  maxBytesFor,
  PAYSLIP_MODEL,
  PAYSLIP_TOOL,
  resolveMediaType,
} from './model.ts'

/** A Messages API response carrying `input` as the forced tool's call. */
function toolResponse(input: unknown): Response {
  return Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: PAYSLIP_MODEL,
    content: [{ type: 'tool_use', id: 'toolu_test', name: PAYSLIP_TOOL.name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 120 },
  })
}

/** A stub transport that records the one request it is given. */
function stub(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const requests: Record<string, unknown>[] = []
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    requests.push(body)
    return await respond(body)
  }) as unknown as typeof fetch
  return { requests, fetchImpl }
}

const FIELDS = {
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
}

Deno.test('the extractor sends a PDF as a document block against the pinned model', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(FIELDS))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  assertEquals(result.ok, true)
  assertEquals(result.ok && result.fields.gross, '4,120.50')

  const [body] = requests
  assertEquals(body.model, PAYSLIP_MODEL)
  assertEquals(body.tool_choice, { type: 'tool', name: 'record_payslip' })
  assertEquals((body.tools as { name: string }[])[0].name, 'record_payslip')
  // The prompt is what keeps the model reporting printed text rather than maths.
  assertEquals(String(body.system).includes('literal text printed on the slip'), true)

  const content = body.messages as { content: Record<string, unknown>[] }[]
  const [file, instruction] = content[0].content
  assertEquals(file.type, 'document')
  assertEquals(file.source, {
    type: 'base64',
    media_type: 'application/pdf',
    data: 'AQID',
  })
  // The file comes before the instruction, as the vision guidance recommends.
  assertEquals(instruction.type, 'text')
})

Deno.test('the extractor sends a photographed slip as an image block', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(FIELDS))
  await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'image/jpeg',
    bytes: new Uint8Array([255, 216, 255]),
  })

  const content = (requests[0].messages as { content: Record<string, unknown>[] }[])[0].content
  assertEquals(content[0].type, 'image')
  assertEquals((content[0].source as Record<string, unknown>).media_type, 'image/jpeg')
})

Deno.test('a slip splitting PAYG from STSL is read at its tax total', async () => {
  // The real slip: a TAX section printing PAYG 1,416.00 and STSL 434.00 over a
  // total of 1,850.00. The total is what net pay reconciles against, and what the
  // estimate's liability — which already carries the HELP repayment the STSL pays
  // — has to be netted against.
  const { requests, fetchImpl } = stub(() =>
    toolResponse({
      ...FIELDS,
      gross: '5,495.50',
      tax_withheld: '1,850.00',
      net: '3,645.50',
      ytd_tax_withheld: '5,550.00',
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  assertEquals(result.ok, true)
  const fields = result.ok ? toExtraction(result.fields).fields : null
  // The total, not the 141_600 PAYG line. Net reconciles against it:
  // 549_550 − 185_000 = 364_550, where the PAYG line alone leaves 407_950.
  assertEquals(fields?.tax_withheld_cents, 185_000)
  assertEquals(fields?.ytd_tax_withheld_cents, 555_000)
  assertEquals(fields?.gross_cents, 549_550)
  assertEquals(fields?.net_cents, 364_550)

  // What steers the model to the total: the field descriptions the request carries.
  const schema = (requests[0].tools as {
    input_schema: { properties: Record<string, { description: string }> }
  }[])[0].input_schema
  assertStringIncludes(schema.properties.tax_withheld.description, 'Total tax withheld')
  assertStringIncludes(
    schema.properties.tax_withheld.description,
    'total of the slip’s tax section',
  )
  assertStringIncludes(schema.properties.tax_withheld.description, 'STSL')
  // Read the printed total: the system prompt forbids deriving a figure by adding.
  assertStringIncludes(
    schema.properties.tax_withheld.description,
    'never one you work out from the components',
  )
  assertStringIncludes(String(requests[0].system), 'Never derive a figure by adding')
  assertStringIncludes(schema.properties.ytd_tax_withheld.description, 'not the PAYG line alone')
})

Deno.test('every extracted field is nullable in the tool schema', () => {
  const schema = PAYSLIP_TOOL.input_schema as {
    properties: Record<string, { anyOf?: { type: string }[]; type?: string }>
    required: string[]
  }
  const nullable = Object.entries(schema.properties)
    .filter(([name]) => name !== 'is_payslip')
    .every(([, property]) => property.anyOf?.some((option) => option.type === 'null'))

  assertEquals(nullable, true)
  // Required-but-nullable: the model must answer for every field, and "not on the
  // slip" is a valid answer.
  assertEquals(schema.required.includes('gross'), true)
  assertEquals(schema.required.includes('is_payslip'), true)
})

Deno.test('the extractor reports a response with no extraction as malformed', async () => {
  const { fetchImpl } = stub(() =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: PAYSLIP_MODEL,
      content: [{ type: 'text', text: 'Here is the payslip: gross was $4,120.50.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 20 },
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(result.ok, false)
  assertEquals(!result.ok && result.failure, 'malformed')
})

Deno.test('the extractor reports a refusal as its own failure, not a server error', async () => {
  const { fetchImpl } = stub(() =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: PAYSLIP_MODEL,
      content: [],
      stop_reason: 'refusal',
      stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 0 },
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'refused')
})

Deno.test('the extractor reports an unusable tool input as malformed', async () => {
  const { fetchImpl } = stub(() => toolResponse({ gross: '4,120.50' })) // No is_payslip.
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'malformed')
})

Deno.test('the extractor surfaces an API error with its status', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } },
      { status: 400 },
    )
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  // A genuinely malformed request carries the same status and type as an
  // exhausted balance, so this is the case the credit match must not swallow.
  assertEquals(!result.ok && result.failure, 'api_error')
  assertEquals(!result.ok && result.status, 400)
})

Deno.test('the extractor reads an exhausted credit balance as its own failure', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
        },
      },
      { status: 400 },
    )
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'no_credit')
  assertEquals(!result.ok && result.status, 400)
})

Deno.test('the extractor reads a billing error as an empty account whatever its status', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      { type: 'error', error: { type: 'billing_error', message: 'billing is not in order' } },
      { status: 403 },
    )
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'no_credit')
})

Deno.test('the extractor surfaces a rate limit as its own status', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      { status: 429 },
    )
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'image/png',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.status, 429)
  // A spend limit is reported exactly as a request-rate limit, so a 429 is never
  // read as an empty account: waiting is the right advice for both.
  assertEquals(!result.ok && result.failure, 'api_error')
})

Deno.test('the extractor surfaces a transport failure without throwing', async () => {
  const fetchImpl = (() => Promise.reject(new TypeError('network down'))) as unknown as typeof fetch
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'api_error')
})

Deno.test('resolveMediaType prefers the recorded content type', () => {
  assertEquals(resolveMediaType('application/pdf', 'hh/slip.pdf'), 'application/pdf')
  assertEquals(resolveMediaType('image/jpeg; charset=binary', 'hh/slip'), 'image/jpeg')
  assertEquals(resolveMediaType('IMAGE/PNG', 'hh/slip'), 'image/png')
})

Deno.test('resolveMediaType falls back to the extension when Storage records none', () => {
  assertEquals(resolveMediaType(null, 'hh/slip.pdf'), 'application/pdf')
  assertEquals(resolveMediaType('application/octet-stream', 'hh/slip.JPG'), 'image/jpeg')
  assertEquals(resolveMediaType(undefined, 'hh/slip.jpeg'), 'image/jpeg')
  assertEquals(resolveMediaType('', 'hh/slip.webp'), 'image/webp')
})

Deno.test('resolveMediaType rejects anything the model cannot read', () => {
  assertEquals(resolveMediaType('image/heic', 'hh/slip.heic'), null)
  assertEquals(resolveMediaType('application/vnd.ms-excel', 'hh/slip.xlsx'), null)
  assertEquals(resolveMediaType(null, 'hh/slip'), null)
  assertEquals(resolveMediaType('text/html', 'hh/slip.html'), null)
})

Deno.test('maxBytesFor caps PDFs and images separately', () => {
  assertEquals(maxBytesFor('application/pdf'), MAX_PDF_BYTES)
  assertEquals(maxBytesFor('image/jpeg'), MAX_IMAGE_BYTES)
  assertEquals(maxBytesFor('image/png'), MAX_IMAGE_BYTES)
  // Base64 inflates by 4/3: both caps stay inside the API's per-image and
  // whole-request limits.
  assertEquals(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) < 10 * 1000 * 1000, true)
  assertEquals(Math.ceil(MAX_PDF_BYTES * 4 / 3) < 32 * 1000 * 1000, true)
})
