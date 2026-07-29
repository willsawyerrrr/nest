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

Deno.test('the real slip comes back itemised, each line as printed', async () => {
  // The slip in full: three earnings rows over a TOTAL of 5,495.50, and a TAX
  // section splitting PAYG from STSL over a total of 1,850.00.
  const { requests, fetchImpl } = stub(() =>
    toolResponse({
      ...FIELDS,
      period_start: '2026-06-27',
      period_end: '2026-07-10',
      paid_on: '2026-07-13',
      gross: '5,495.50',
      tax_withheld: '1,850.00',
      super: '600.00',
      net: '3,645.50',
      earnings_lines: [
        { label: 'Ordinary Hours', period_amount: '$4,000.00', ytd_amount: '$12,000.00' },
        { label: 'Annual Leave', period_amount: '$1,000.00', ytd_amount: '$1,000.00' },
        { label: 'On-call (T1)', period_amount: '$495.50', ytd_amount: '$1,486.50' },
      ],
      tax_lines: [
        { label: 'PAYG', period_amount: '$1,416.00', ytd_amount: '$4,248.00', component: 'payg' },
        {
          label: 'STSL Component',
          period_amount: '$434.00',
          ytd_amount: '$1,302.00',
          component: 'stsl',
        },
      ],
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  assertEquals(result.ok, true)
  const extraction = result.ok ? toExtraction(result.fields) : null
  assertEquals(extraction?.lines.earnings, [
    { label: 'Ordinary Hours', amount: '$4,000.00', amount_cents: 4_000_00 },
    { label: 'Annual Leave', amount: '$1,000.00', amount_cents: 1_000_00 },
    { label: 'On-call (T1)', amount: '$495.50', amount_cents: 495_50 },
  ])
  assertEquals(extraction?.lines.tax, [
    { label: 'PAYG', amount: '$1,416.00', amount_cents: 1_416_00, component: 'payg' },
    { label: 'STSL Component', amount: '$434.00', amount_cents: 434_00, component: 'stsl' },
  ])
  // The section totals stay the scalar fields, so nothing is counted twice: the
  // three lines sum to the gross, which the TOTAL row coming through as a fourth
  // line would double.
  assertEquals(extraction?.fields.gross_cents, 549_550)
  assertEquals(extraction?.fields.tax_withheld_cents, 185_000)
  assertEquals(
    extraction?.lines.earnings.reduce((sum, line) => sum + (line.amount_cents ?? 0), 0),
    549_550,
  )

  // What keeps a TOTAL row out of the lines, and every line amount the printed text.
  const system = String(requests[0].system)
  assertStringIncludes(system, 'Never report a TOTAL or subtotal')
  assertStringIncludes(system, 'count that money twice')
  assertStringIncludes(system, 'Never derive a figure by adding')
})

Deno.test('a row the slip prints year to date alone is no line of this pay', async () => {
  // The same slip with a fourth earnings row — money paid in earlier periods,
  // printed in the year-to-date column only, its period column empty.
  const { requests, fetchImpl } = stub(() =>
    toolResponse({
      ...FIELDS,
      gross: '5,495.50',
      tax_withheld: '1,850.00',
      net: '3,645.50',
      earnings_lines: [
        { label: 'Ordinary Hours', period_amount: '$4,000.00', ytd_amount: '$12,000.00' },
        { label: 'Annual Leave', period_amount: '$1,000.00', ytd_amount: '$1,000.00' },
        { label: 'On-call (T1)', period_amount: '$495.50', ytd_amount: '$1,486.50' },
        { label: 'Other Previous Earnings', period_amount: null, ytd_amount: '$1,000.00' },
      ],
      tax_lines: [
        { label: 'PAYG', period_amount: '$1,416.00', ytd_amount: '$4,248.00', component: 'payg' },
        // Withheld this year but not this period: no component of this pay's tax.
        { label: 'STSL Component', period_amount: null, ytd_amount: '$434.00', component: 'stsl' },
      ],
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  const extraction = result.ok ? toExtraction(result.fields) : null
  assertEquals(extraction?.lines.earnings.map((line) => line.label), [
    'Ordinary Hours',
    'Annual Leave',
    'On-call (T1)',
  ])
  assertEquals(extraction?.lines.tax.map((line) => line.label), ['PAYG'])
  // The itemisation accounts for this pay's gross exactly, which the year-to-date
  // row coming through as a fourth line would overstate by 100_000.
  assertEquals(
    extraction?.lines.earnings.reduce((sum, line) => sum + (line.amount_cents ?? 0), 0),
    549_550,
  )
  assertEquals(extraction?.fields.gross_cents, 549_550)
  // Not a gap either: the row is not part of this pay, so there is nothing to fill.
  assertEquals(extraction?.unreadable, [])

  // What steers the model to the period column and keeps the year-to-date figure
  // out of it: the system prompt and the two per-column descriptions.
  const system = String(requests[0].system)
  assertStringIncludes(system, 'never carry a year-to-date figure across into')
  assertStringIncludes(system, 'its period amount is null')
  // Equal columns are legitimate on the first pay of a year, so they are asked for.
  assertStringIncludes(system, 'first pay of a financial year')

  const items = (requests[0].tools as {
    input_schema: {
      properties: Record<
        string,
        { anyOf?: { items?: { properties: Record<string, { description: string }> } }[] }
      >
    }
  }[])[0].input_schema.properties.earnings_lines.anyOf?.[0].items?.properties
  assertStringIncludes(items?.period_amount.description ?? '', 'CURRENT PAY PERIOD')
  assertStringIncludes(
    items?.period_amount.description ?? '',
    'printed only in the year-to-date column is money paid in earlier periods',
  )
  assertStringIncludes(items?.ytd_amount.description ?? '', 'YEAR-TO-DATE')
})

Deno.test('a tax line the model could not place comes back unnamed, never PAYG', async () => {
  const { fetchImpl } = stub(() =>
    toolResponse({
      ...FIELDS,
      tax_withheld: '1,048.00',
      tax_lines: [{
        label: 'Tax deducted',
        period_amount: '$1,048.00',
        ytd_amount: '$3,144.00',
        component: null,
      }],
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  const extraction = result.ok ? toExtraction(result.fields) : null
  assertEquals(extraction?.lines.tax, [
    { label: 'Tax deducted', amount: '$1,048.00', amount_cents: 1_048_00, component: null },
  ])
})

Deno.test('the tool schema asks for the printed lines and forbids the TOTAL rows', () => {
  const schema = PAYSLIP_TOOL.input_schema as {
    properties: Record<string, {
      anyOf?: {
        type: string
        items?: { properties: Record<string, unknown>; required: string[] }
      }[]
      description: string
    }>
    required: string[]
  }

  for (const name of ['earnings_lines', 'tax_lines']) {
    const property = schema.properties[name]
    // Required but nullable, exactly as every scalar field is: a slip printing no
    // line detail is a valid answer.
    assertEquals(schema.required.includes(name), true)
    assertEquals(property.anyOf?.some((option) => option.type === 'null'), true)
    assertStringIncludes(property.description, 'as printed')
    assertStringIncludes(property.description, 'in the order printed')
    // Reporting a section's total again as a line would double the section.
    assertStringIncludes(property.description, 'TOTAL row')
  }

  const items = schema.properties.tax_lines.anyOf?.[0].items
  // Both columns are answered for on every row: a row printing an amount only year
  // to date has somewhere to put it other than this period's figure.
  assertEquals(items?.required, ['label', 'period_amount', 'ytd_amount', 'component'])
  // Only the two parts of the liability, and null for a line the slip does not place.
  assertEquals((items?.properties.component as { anyOf: unknown[] }).anyOf, [
    { type: 'string', enum: ['payg', 'stsl'] },
    { type: 'null' },
  ])
  // An earnings line is never asked which inflow it draws on: the household's
  // inflows are not on the slip, so attribution is the client's own job.
  assertEquals(
    Object.keys(schema.properties.earnings_lines.anyOf?.[0].items?.properties ?? {}),
    ['label', 'period_amount', 'ytd_amount'],
  )
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

  // The `403` this arrives on is also the refused-key status, so the API's own
  // type is what keeps them apart: topping an account up is not rotating a key.
  assertEquals(!result.ok && result.failure, 'no_credit')
})

Deno.test('the extractor reads a refused key as its own failure', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      { status: 401 },
    )
  )
  const result = await anthropicExtractor('sk-ant-wrong', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'key_rejected')
  assertEquals(!result.ok && result.status, 401)
})

Deno.test('the extractor reads a key without permission as the same refused key', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      {
        type: 'error',
        error: { type: 'permission_error', message: 'this key lacks permission for that request' },
      },
      { status: 403 },
    )
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  // Nothing the member can act on either way, and one operator fix: a key that is
  // valid but not permitted is replaced exactly as a wrong one is.
  assertEquals(!result.ok && result.failure, 'key_rejected')
  assertEquals(!result.ok && result.status, 403)
})

Deno.test('the extractor keeps a 401 carrying no API verdict out of the refused-key case', async () => {
  const { fetchImpl } = stub(() =>
    // A proxy or gateway in front of the API: a 401 with no Anthropic error body,
    // so nothing says the key itself was refused.
    new Response('<html>401 Unauthorized</html>', {
      status: 401,
      headers: { 'content-type': 'text/html' },
    })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'api_error')
  assertEquals(!result.ok && result.status, 401)
})

Deno.test('the extractor keeps a server failure out of the refused-key case', async () => {
  const { fetchImpl } = stub(() =>
    Response.json(
      { type: 'error', error: { type: 'api_error', message: 'internal server error' } },
      { status: 500 },
    )
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1]),
  })

  assertEquals(!result.ok && result.failure, 'api_error')
  assertEquals(!result.ok && result.status, 500)
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
