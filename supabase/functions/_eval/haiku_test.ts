import Anthropic from '@anthropic-ai/sdk'
import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  ARMS,
  buildRequest,
  type ClaudeRunResult,
  costNanoUsd,
  documentExtractors,
  engineName,
  engineSpecs,
  type Input,
  type MessageRequest,
  parseArgs,
  projectCost,
  runEngine,
  runOnce,
  textFile,
  THINKING_ALLOWANCE,
} from './haiku.ts'
import type { CorpusDoc } from './corpus.ts'

const pdf: Input = { media: 'pdf', bytes: new Uint8Array([1, 2, 3]) }

function message(
  content: Anthropic.ContentBlock[],
  overrides: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
    ...overrides,
  } as Anthropic.Message
}

const toolUse = (input: unknown, name = 'record_receipt'): Anthropic.ContentBlock =>
  ({ type: 'tool_use', id: 't', name, input }) as Anthropic.ContentBlock

const RECEIPT = {
  is_receipt: true,
  not_receipt_reason: null,
  description: 'Printer paper',
  deduction_date: '2025-03-05',
  amount: '$12.50',
}

function stub(...replies: Array<Anthropic.Message | Error>) {
  const requests: MessageRequest[] = []
  return {
    requests,
    client: {
      messages: {
        create: (params: MessageRequest) => {
          requests.push(params)
          const reply = replies.shift()!
          return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)
        },
      },
    },
  }
}

Deno.test('every arm sends a strict tool with auto choice, never forced, and no sampling', () => {
  for (const arm of Object.values(ARMS)) {
    for (const kind of ['payslip', 'deduction', 'trade'] as const) {
      const request = buildRequest(arm, arm.effort ? 'medium' : null, kind, 2025, pdf)
      assertEquals(request.tool_choice, { type: 'auto' })
      assertEquals(request.tools.length, 1)
      assert(request.tools[0].strict)
      assert(request.system.includes(`\`${request.tools[0].name}\``))
      for (const banned of ['temperature', 'top_p', 'top_k']) assert(!(banned in request))
    }
  }
})

Deno.test('thinking and effort follow the arm', () => {
  const at = (id: keyof typeof ARMS) => buildRequest(ARMS[id], 'high', 'deduction', 2025, pdf)
  const haiku4 = at('haiku-4-5')
  assertEquals(haiku4.model, 'claude-haiku-4-5')
  assert(!('thinking' in haiku4) && !('output_config' in haiku4))
  assertEquals(haiku4.max_tokens, 512)
  for (const id of ['haiku-5-5', 'sonnet-5-5', 'opus-5-5'] as const) {
    const request = at(id)
    assertEquals(request.thinking, { type: 'adaptive' })
    assertEquals(request.output_config, { effort: 'high' })
    assertEquals(request.max_tokens, 512 + THINKING_ALLOWANCE)
  }
  const fable = at('fable-5-2')
  assertEquals(fable.model, 'claude-fable-5-2')
  assert(!('thinking' in fable))
  assertEquals(fable.output_config, { effort: 'high' })
})

Deno.test('inputs: the PDF and PNG as native blocks, the text layer inline', () => {
  const arm = ARMS['sonnet-5-5']
  const content = (input: Input) =>
    buildRequest(arm, 'low', 'payslip', 2025, input).messages[0].content as Array<
      { type: string; source?: { media_type: string }; text?: string }
    >
  const document = content(pdf)
  assertEquals(document[0].type, 'document')
  assertEquals(document[0].source?.media_type, 'application/pdf')
  assertEquals(document[1].text, 'Read this payslip and record its fields.')
  const image = content({ media: 'png', bytes: new Uint8Array([9]) })
  assertEquals([image[0].type, image[0].source?.media_type], ['image', 'image/png'])
  const text = content({ media: 'text', text: 'Gross 100.00' })
  assertEquals(text.length, 1)
  assertEquals(
    text[0].text,
    'Read this payslip and record its fields.\n\nDocument text:\nGross 100.00',
  )
})

Deno.test('cost is integer nanodollars from the price table, with the long-prompt tier', () => {
  assertEquals(costNanoUsd(ARMS['haiku-4-5'], 2_000, 200), 3_000_000)
  assertEquals(costNanoUsd(ARMS['haiku-5-5'], 2_000, 200), 300_000)
  assertEquals(costNanoUsd(ARMS['haiku-5-5'], 100_000, 0), 10_000_000)
  assertEquals(costNanoUsd(ARMS['haiku-5-5'], 100_001, 0), 50_000_500)
  assertEquals(costNanoUsd(ARMS['fable-5-2'], 5_000, 800), 72_000_000)
})

Deno.test('a successful run records usage, cost, effort, latency and the raw fields', async () => {
  const { client, requests } = stub(
    message([toolUse(RECEIPT)], { usage: { input_tokens: 2_000, output_tokens: 1_200 } as never }),
  )
  const run = await runOnce(client, ARMS['opus-5-5'], 'medium', 'deduction', 2025, pdf)
  assertEquals(run.error, undefined)
  assertEquals((run.raw as { amount: string }).amount, '$12.50')
  assertEquals(run.effort, 'medium')
  assertEquals([run.inputTokens, run.outputTokens, run.promptTokens], [2_000, 1_200, 2_000])
  assertEquals(run.costNanoUsd, 2_000 * 4_000 + 1_200 * 20_000)
  assertEquals(run.stopReason, 'tool_use')
  assert(run.ms >= 0)
  assertEquals(requests[0].output_config, { effort: 'medium' })
})

Deno.test('refusals, cut-off answers, prose and unreadable tools are errors that keep their usage', async () => {
  const cases: Array<[Anthropic.Message, string]> = [
    [message([], { stop_reason: 'refusal' }), 'refused'],
    [message([toolUse(RECEIPT)], { stop_reason: 'max_tokens' }), 'cut_short'],
    [
      message([{ type: 'text', text: 'prose' } as Anthropic.ContentBlock], {
        stop_reason: 'end_turn',
      }),
      'no_tool_call',
    ],
    [message([toolUse({ nope: true })]), 'malformed'],
  ]
  for (const [reply, error] of cases) {
    const run = await runOnce(stub(reply).client, ARMS['haiku-4-5'], null, 'deduction', 2025, pdf)
    assertEquals(run.error, error)
    assertEquals(run.inputTokens, 1000)
    assert(run.costNanoUsd! > 0)
  }
})

Deno.test('an API failure is a run error without upstream detail', async () => {
  const failure = new Anthropic.APIError(
    400,
    { error: { message: 'secret detail' } },
    'secret detail',
    new Headers(),
  )
  const run = await runOnce(stub(failure).client, ARMS['fable-5-2'], 'low', 'trade', 2025, pdf)
  assertEquals(run.error, 'api_error:400')
  assertEquals(run.raw, undefined)
  assertEquals(run.costNanoUsd, undefined)
})

const doc = (id: string, kind: CorpusDoc['kind']) =>
  ({ id, kind, financialYear: 2025, rows: [], label: {} }) as unknown as CorpusDoc

Deno.test('engines: effort only on arms that take it, one engine per media', () => {
  const specs = engineSpecs(['haiku-4-5', 'sonnet-5-5'], ['low', 'high'], ['pdf', 'text'])
  assertEquals(specs.map((s) => s.name), [
    'claude-haiku-4-5-pdf',
    'claude-haiku-4-5-text',
    'claude-sonnet-5-5-low-pdf',
    'claude-sonnet-5-5-low-text',
    'claude-sonnet-5-5-high-pdf',
    'claude-sonnet-5-5-high-text',
  ])
  assertEquals(engineName('fable-5-2', 'medium', 'png'), 'claude-fable-5-2-medium-png')
})

Deno.test('the projection counts each extractor a document runs through, times repeats', () => {
  const corpus = [doc('a', 'deduction'), doc('b', 'other')]
  const specs = engineSpecs(['haiku-4-5'], [], ['pdf'])
  const projection = projectCost(corpus, specs, 5)
  // a: deduction; b: all three, so four extractor runs a repeat.
  assertEquals(projection.runs, 20)
  const per = (input: number, output: number) => costNanoUsd(ARMS['haiku-4-5'], input, output)
  assertEquals(
    projection.costNanoUsd,
    5 * (2 * per(2_000, 200) + per(5_000, 800) + per(8_000, 1_500)),
  )
})

Deno.test('runEngine writes the scorer shape: first repeat in results, every repeat in repeats', async () => {
  const reply = () => message([toolUse(RECEIPT)])
  const { client } = stub(reply(), reply(), reply(), reply())
  const spec = engineSpecs(['haiku-4-5'], [], ['pdf'])[0]
  const lines: string[] = []
  const output = await runEngine(
    client,
    spec,
    { docs: [doc('a', 'deduction'), doc('b', 'deduction')], load: () => Promise.resolve(pdf) },
    2,
    { corpusSha256: 'abc', commit: null, startedAt: 'now' },
    (line) => lines.push(line),
  )
  assertEquals(output.engine, 'claude-haiku-4-5-pdf')
  assertEquals(Object.keys(output.results), ['a:deduction', 'b:deduction'])
  assertEquals(output.repeats['a:deduction'].length, 2)
  assertEquals(output.results['a:deduction'], output.repeats['a:deduction'][0] as ClaudeRunResult)
  assertEquals(output.meta.model, 'claude-haiku-4-5')
  assertEquals(output.meta.effort, null)
  assertEquals(lines.length, 2)
})

Deno.test('arguments are validated', () => {
  const parsed = parseArgs(['out', '--arms', 'opus-5-5', '--repeats', '2', '--dry-run'])
  assertEquals([parsed.dir, parsed.arms, parsed.repeats, parsed.dryRun], [
    'out',
    ['opus-5-5'],
    2,
    true,
  ])
  assertEquals(parseArgs(['out']).repeats, 5)
  assertEquals(parseArgs(['out']).efforts, ['low', 'medium', 'high'])
  assertThrows(() => parseArgs([]))
  assertThrows(() => parseArgs(['out', '--arms', 'gpt']))
  assertThrows(() => parseArgs(['out', '--repeats', '0']))
  assertThrows(() => parseArgs(['out', '--bogus', 'x']))
})

Deno.test('a variant without a text layer is skipped on the text path, and reads its source text', () => {
  const scan: CorpusDoc = { ...doc('a.scan', 'deduction'), profile: 'scan', textLayer: false }
  const digital: CorpusDoc = {
    ...doc('a.born-digital', 'deduction'),
    profile: 'born-digital',
    textLayer: true,
  }
  assertEquals(documentExtractors(scan, 'text'), [])
  assertEquals(documentExtractors(scan, 'png'), ['deduction'])
  assertEquals(documentExtractors(digital, 'text'), ['deduction'])
  assertEquals(textFile(digital), 'a')
  assertEquals(textFile(doc('a', 'deduction')), 'a')
  assertEquals(projectCost([scan], engineSpecs(['haiku-4-5'], [], ['text']), 1).runs, 0)
})
