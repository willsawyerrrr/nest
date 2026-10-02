import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { MAX_UPLOAD_BYTES } from '../upload.ts'
import { addWishlistItem, createDeductionFromDocument, createDeductionInput } from './write.ts'

const tables = { members }
const pdf = new Uint8Array([1, 2, 3])

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('addWishlistItem', () => {
  it('inserts into the household with the named member', async () => {
    const { ctx, state } = fakeContext({ tables })
    const result = await addWishlistItem(ctx, {
      name: 'Bike',
      amount_cents: 1_200_00,
      member: 'sam',
      note: 'Red',
    })
    expect(state.inserts).toEqual([
      {
        table: 'wishlist_item',
        row: {
          household_id: 'h-1',
          name: 'Bike',
          amount_cents: 1_200_00,
          member_id: 'm-other',
          note: 'Red',
        },
      },
    ])
    expect(result).toMatchObject({ id: 'new-id', member: 'Sam' })
  })

  it('leaves the member and note null when not given', async () => {
    const { ctx, state } = fakeContext({ tables })
    await addWishlistItem(ctx, { name: 'Bike', amount_cents: 5_00 })
    expect(state.inserts[0]?.row).toMatchObject({ member_id: null, note: null })
  })

  it('rejects an unknown member', async () => {
    const { ctx } = fakeContext({ tables })
    const error = await failure(
      addWishlistItem(ctx, { name: 'Bike', amount_cents: 5_00, member: 'Nobody' }),
    )
    expect(error.code).toBe('not_found')
  })

  it('reports a failed insert with fixed copy', async () => {
    const { ctx } = fakeContext({ tables, insertError: true })
    const error = await failure(addWishlistItem(ctx, { name: 'Bike', amount_cents: 5_00 }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('createDeductionFromDocument', () => {
  const base = createDeductionInput.parse({ file_path: '/tmp/Receipt 1.pdf' })
  const read = {
    data: {
      model: 'm',
      fields: { description: 'Laptop', amount_cents: 999_99, deduction_date: '2026-08-14' },
    },
  }

  it('uploads under the household and minted id, reads, and creates with the receipt', async () => {
    const { ctx, state } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      invoke: read,
    })
    const result = await createDeductionFromDocument(ctx, base)

    expect(state.uploads).toEqual([
      {
        path: 'h-1/uuid-1/uuid-2-Receipt_1.pdf',
        contentType: 'application/pdf',
        bytes: 3,
      },
    ])
    expect(state.invocations).toEqual([
      {
        fn: 'deduction-extract',
        body: {
          path: 'h-1/uuid-1/uuid-2-Receipt_1.pdf',
          category: 'work_expense',
          financialYear: 2027,
        },
      },
    ])
    expect(state.rpcCalls).toEqual([
      {
        fn: 'create_deduction_with_receipt',
        args: {
          p_deduction: {
            id: 'uuid-1',
            household_id: 'h-1',
            member_id: 'm-self',
            description: 'Laptop',
            amount_cents: 999_99,
            deduction_date: '2026-08-14',
            financial_year: 2027,
            category: 'work_expense',
          },
          p_receipt_path: 'h-1/uuid-1/uuid-2-Receipt_1.pdf',
        },
      },
    ])
    expect(result.fields_read_from_document).toEqual([
      'description',
      'amount_cents',
      'deduction_date',
    ])
    expect(result.note).toContain('extracted by AI')
    expect(state.removed).toEqual([])
  })

  it('prefers stated values and skips extraction when all are given', async () => {
    const { ctx, state } = fakeContext({ tables, files: { '/tmp/Receipt 1.pdf': pdf } })
    const result = await createDeductionFromDocument(ctx, {
      ...base,
      category: 'donation',
      member: 'Sam',
      description: 'Charity',
      amount_cents: 50_00,
      deduction_date: '2026-06-30',
    })
    expect(state.invocations).toEqual([])
    expect(result).toMatchObject({
      member: 'Sam',
      financial_year: 2026,
      fields_read_from_document: [],
      note: null,
    })
  })

  it('lets stated values override read ones and primes extraction with the stated date year', async () => {
    const { ctx, state } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      invoke: read,
    })
    const result = await createDeductionFromDocument(ctx, {
      ...base,
      amount_cents: 1_00,
      deduction_date: '2025-08-01',
    })
    expect(result).toMatchObject({
      amount_cents: 1_00,
      description: 'Laptop',
      deduction_date: '2025-08-01',
      financial_year: 2026,
    })
    expect(state.invocations[0]?.body).toMatchObject({ financialYear: 2026 })
  })

  it('primes extraction with a stated financial year', async () => {
    const { ctx, state } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      invoke: read,
    })
    await createDeductionFromDocument(ctx, { ...base, financial_year: 2025 })
    expect(state.invocations[0]?.body).toMatchObject({ financialYear: 2025 })
  })

  it('stores a file type the model cannot read as an opaque download and needs details', async () => {
    const files = { '/tmp/page.html': pdf }
    const { ctx, state } = fakeContext({ tables, files })
    const error = await failure(
      createDeductionFromDocument(ctx, { ...base, file_path: '/tmp/page.html' }),
    )
    expect(error.code).toBe('extraction_unsupported_type')
    expect(state.uploads[0]?.contentType).toBe('application/octet-stream')
    expect(state.invocations).toEqual([])
    expect(state.removed).toEqual([state.uploads[0]?.path])
  })

  it('creates from an unreadable type when the details are all stated', async () => {
    const { ctx, state } = fakeContext({ tables, files: { '/tmp/page.html': pdf } })
    await createDeductionFromDocument(ctx, {
      ...base,
      file_path: '/tmp/page.html',
      description: 'Page',
      amount_cents: 1_00,
      deduction_date: '2026-08-01',
    })
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.removed).toEqual([])
  })

  it('reports an unreadable path', async () => {
    const { ctx, state } = fakeContext({ tables })
    expect((await failure(createDeductionFromDocument(ctx, base))).code).toBe('file_unreadable')
    expect(state.uploads).toEqual([])
  })

  it('refuses a file over 25 MiB', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    const { ctx, state } = fakeContext({ tables, files: { '/tmp/Receipt 1.pdf': big } })
    expect((await failure(createDeductionFromDocument(ctx, base))).code).toBe('file_too_large')
    expect(state.uploads).toEqual([])
  })

  it('reports a failed upload', async () => {
    const { ctx } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      uploadError: true,
    })
    const error = await failure(createDeductionFromDocument(ctx, base))
    expect(error.code).toBe('upload_failed')
    expect(error.message).not.toContain('upstream')
  })

  it.each([
    [
      { status: 503, body: { configured: false, error: 'secret-key-detail' } },
      'extraction_unavailable',
    ],
    [{ status: 503, body: { outOfCredit: true } }, 'extraction_unavailable'],
    [{ status: 503, body: { keyRejected: true } }, 'extraction_unavailable'],
    [
      { status: 422, body: { notReceipt: true, reason: 'upstream words' } },
      'extraction_not_receipt',
    ],
    [{ status: 415, body: { code: 'unsupported_type' } }, 'extraction_unsupported_type'],
    [{ status: 500, body: { error: 'upstream words' } }, 'extraction_failed'],
    ['transport' as const, 'extraction_failed'],
  ])(
    'maps an extraction failure %# to %s without passing the body through',
    async (failureCase, code) => {
      const { ctx, state } = fakeContext({
        tables,
        files: { '/tmp/Receipt 1.pdf': pdf },
        invoke: { failure: failureCase },
      })
      const error = await failure(createDeductionFromDocument(ctx, base))
      expect(error.code).toBe(code)
      expect(error.message).not.toContain('upstream')
      expect(error.message).not.toContain('secret')
      expect(state.rpcCalls).toEqual([])
      expect(state.removed).toHaveLength(1)
    },
  )

  it('treats an unparseable extraction body as a failed read', async () => {
    const { ctx } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      invoke: { data: { nope: true } },
    })
    expect((await failure(createDeductionFromDocument(ctx, base))).code).toBe('extraction_failed')
  })

  it('names the details the document did not show', async () => {
    const { ctx, state } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      invoke: { data: { model: 'm', fields: { description: 'Laptop' } } },
    })
    const error = await failure(createDeductionFromDocument(ctx, base))
    expect(error.code).toBe('incomplete_details')
    expect(error.message).toContain('amount_cents, deduction_date')
    expect(state.removed).toHaveLength(1)
  })

  it('deletes the stored file when the save fails', async () => {
    const { ctx, state } = fakeContext({
      tables,
      files: { '/tmp/Receipt 1.pdf': pdf },
      invoke: read,
      rpcError: true,
    })
    const error = await failure(createDeductionFromDocument(ctx, base))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
    expect(state.removed).toEqual([state.uploads[0]?.path])
  })
})

describe('input schemas', () => {
  it('defaults the category and rejects non-integer cents and impossible dates', () => {
    expect(createDeductionInput.parse({ file_path: 'a.pdf' }).category).toBe('work_expense')
    expect(createDeductionInput.safeParse({ file_path: 'a', amount_cents: 1.5 }).success).toBe(
      false,
    )
    expect(createDeductionInput.safeParse({ file_path: 'a', amount_cents: -1 }).success).toBe(false)
    expect(
      createDeductionInput.safeParse({ file_path: 'a', deduction_date: '2026-02-30' }).success,
    ).toBe(false)
    expect(
      createDeductionInput.safeParse({ file_path: 'a', deduction_date: '26-1-1' }).success,
    ).toBe(false)
  })
})
