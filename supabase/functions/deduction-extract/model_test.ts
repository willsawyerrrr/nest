import { assertEquals } from '@std/assert'
import { toExtraction } from './fields.ts'
import {
  anthropicExtractor,
  buildReceiptTool,
  DEDUCTION_MODEL,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  maxBytesFor,
  RECEIPT_TOOL,
  resolveMediaType,
} from './model.ts'

/** A Messages API response carrying `input` as the forced tool's call. */
function toolResponse(input: unknown): Response {
  return Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: DEDUCTION_MODEL,
    content: [{ type: 'tool_use', id: 'toolu_test', name: RECEIPT_TOOL.name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 40 },
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
  is_receipt: true,
  not_receipt_reason: null,
  description: 'Officeworks',
  deduction_date: '2026-07-06',
  amount: '124.50',
}

Deno.test('the extractor sends a PDF as a document block against the pinned model', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(FIELDS))
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  assertEquals(result.ok, true)
  assertEquals(result.ok && result.fields.amount, '124.50')

  const [body] = requests
  assertEquals(body.model, DEDUCTION_MODEL)
  assertEquals(body.tool_choice, { type: 'tool', name: 'record_receipt' })
  assertEquals((body.tools as { name: string }[])[0].name, 'record_receipt')
  // The prompt is what keeps the model reporting printed text rather than maths.
  assertEquals(String(body.system).includes('literal text printed on the receipt'), true)

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

Deno.test('the extractor sends a photographed receipt as an image block', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(FIELDS))
  await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'image/jpeg',
    bytes: new Uint8Array([255, 216, 255]),
  })

  const content = (requests[0].messages as { content: Record<string, unknown>[] }[])[0].content
  assertEquals(content[0].type, 'image')
  assertEquals((content[0].source as Record<string, unknown>).media_type, 'image/jpeg')
})

Deno.test('a receipt with no printed business name is read at its item description', async () => {
  const { fetchImpl } = stub(() =>
    toolResponse({ ...FIELDS, description: 'Replacement laptop charger' })
  )
  const result = await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  assertEquals(result.ok, true)
  const extraction = result.ok ? toExtraction(result.fields) : null
  assertEquals(extraction?.fields.description, 'Replacement laptop charger')
})

Deno.test('the tool schema steers the model to the total, never a subtotal or line item', () => {
  const schema = RECEIPT_TOOL.input_schema as {
    properties: Record<string, { description: string }>
  }
  assertEquals(schema.properties.amount.description.includes('total'), true)
})

Deno.test('every extracted field is nullable in the tool schema', () => {
  const schema = RECEIPT_TOOL.input_schema as {
    properties: Record<string, { anyOf?: { type: string }[]; type?: string }>
    required: string[]
  }
  const nullable = Object.entries(schema.properties)
    .filter(([name]) => name !== 'is_receipt')
    .every(([, property]) => property.anyOf?.some((option) => option.type === 'null'))

  assertEquals(nullable, true)
  // Required-but-nullable: the model must answer for every field, and "not on the
  // receipt" is a valid answer.
  assertEquals(schema.required.includes('amount'), true)
  assertEquals(schema.required.includes('is_receipt'), true)
})

Deno.test('the donation tool schema expects a DGR donation tax receipt, not a purchase', () => {
  const schema = buildReceiptTool('donation').input_schema as {
    properties: Record<string, { description: string }>
  }
  const isReceiptDescription = schema.properties.is_receipt.description
  assertEquals(isReceiptDescription.includes('donation tax receipt'), true)
  assertEquals(isReceiptDescription.includes('DGR'), true)
  // Never asked to reject a genuine donation receipt for not being a purchase.
  assertEquals(isReceiptDescription.toLowerCase().includes('purchase'), false)
})

Deno.test('the tax agent fees tool schema expects an invoice for accountant fees', () => {
  const schema = buildReceiptTool('tax_agent_fees').input_schema as {
    properties: Record<string, { description: string }>
  }
  const isReceiptDescription = schema.properties.is_receipt.description
  assertEquals(isReceiptDescription.includes('tax agent or accountant fees'), true)
})

Deno.test('the work expense tool schema keeps expecting a purchase receipt or invoice', () => {
  const schema = buildReceiptTool('work_expense').input_schema as {
    properties: Record<string, { description: string }>
  }
  assertEquals(
    schema.properties.is_receipt.description.includes('a receipt or invoice for a purchase'),
    true,
  )
})

Deno.test('the extractor primes the model for the category it is given', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(FIELDS))
  await anthropicExtractor('sk-ant-test', fetchImpl)(
    { mediaType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
    'donation',
  )

  const [body] = requests
  assertEquals(String(body.system).includes('donation tax receipt'), true)
  assertEquals((body.tools as { name: string }[])[0]!.name, 'record_receipt')
  const tool =
    (body.tools as { input_schema: { properties: Record<string, { description: string }> } }[])[0]!
  assertEquals(tool.input_schema.properties.is_receipt.description.includes('DGR'), true)
})

Deno.test('the extractor defaults to the work-expense category when none is given', async () => {
  const { requests, fetchImpl } = stub(() => toolResponse(FIELDS))
  await anthropicExtractor('sk-ant-test', fetchImpl)({
    mediaType: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  })

  const [body] = requests
  assertEquals(String(body.system).includes('a receipt or invoice for a purchase'), true)
})

Deno.test('the extractor reports a response with no extraction as malformed', async () => {
  const { fetchImpl } = stub(() =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: DEDUCTION_MODEL,
      content: [{ type: 'text', text: 'Here is the receipt: total was $124.50.' }],
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
      model: DEDUCTION_MODEL,
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
  const { fetchImpl } = stub(() => toolResponse({ amount: '124.50' })) // No is_receipt.
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
  assertEquals(resolveMediaType('application/pdf', 'hh/receipt.pdf'), 'application/pdf')
  assertEquals(resolveMediaType('image/jpeg; charset=binary', 'hh/receipt'), 'image/jpeg')
  assertEquals(resolveMediaType('IMAGE/PNG', 'hh/receipt'), 'image/png')
})

Deno.test('resolveMediaType falls back to the extension when Storage records none', () => {
  assertEquals(resolveMediaType(null, 'hh/receipt.pdf'), 'application/pdf')
  assertEquals(resolveMediaType('application/octet-stream', 'hh/receipt.JPG'), 'image/jpeg')
  assertEquals(resolveMediaType(undefined, 'hh/receipt.jpeg'), 'image/jpeg')
  assertEquals(resolveMediaType('', 'hh/receipt.webp'), 'image/webp')
})

Deno.test('resolveMediaType rejects anything the model cannot read', () => {
  assertEquals(resolveMediaType('image/heic', 'hh/receipt.heic'), null)
  assertEquals(resolveMediaType('application/vnd.ms-excel', 'hh/receipt.xlsx'), null)
  assertEquals(resolveMediaType(null, 'hh/receipt'), null)
  assertEquals(resolveMediaType('text/html', 'hh/receipt.html'), null)
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
