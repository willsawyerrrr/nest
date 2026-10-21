import { describe, expect, it } from 'vitest'
import { fakeContext, members } from '../test/fakeContext.ts'
import {
  attachPayslipDocument,
  createPayslipFromDocument,
  removePayslipDocument,
} from './payslipDocuments.ts'
import {
  createPayslip,
  deletePayslip,
  listPayslips,
  payslipFinancialYear,
  updatePayslip,
} from './payslips.ts'

const ID = '11111111-1111-4111-8111-111111111111'

const slip = {
  id: ID,
  household_id: 'h-1',
  member_id: 'm-self',
  financial_year: 2027,
  period_start: '2026-09-14',
  period_end: '2026-09-27',
  paid_on: '2026-09-30',
  gross_cents: 500_000,
  tax_withheld_cents: 120_000,
  super_cents: 57_500,
  net_cents: 380_000,
  salary_sacrifice_cents: null,
  ytd_gross_cents: null,
  ytd_tax_withheld_cents: null,
  ytd_super_cents: null,
  file_path: 'h-1/p/old.pdf',
  note: null,
}

const line = {
  payslip_id: ID,
  kind: 'earning',
  label: 'Ordinary hours',
  amount_cents: 500_000,
  source_inflow_id: 'i-1',
  tax_component: null,
  attracts_super: true,
}

const base = {
  period_start: '2026-09-14',
  period_end: '2026-09-27',
  gross_cents: 500_000,
  tax_withheld_cents: 120_000,
  super_cents: 57_500,
  net_cents: 380_000,
}

describe('payslipFinancialYear', () => {
  it('files by payment date, else period end', () => {
    expect(payslipFinancialYear('2026-07-01', '2026-06-28')).toBe(2027)
    expect(payslipFinancialYear(null, '2026-06-28')).toBe(2026)
  })
})

describe('listPayslips', () => {
  it('returns slips with lines, newest period first, filtered by year', async () => {
    const older = { ...slip, id: 'x', period_end: '2026-09-13', financial_year: 2027 }
    const other = { ...slip, id: 'y', financial_year: 2026 }
    const { ctx } = fakeContext({
      tables: { payslip: [older, slip, other], payslip_line: [line], members },
    })
    const result = await listPayslips(ctx, { financial_year: 2027 })
    expect(result.payslips.map((p) => p.id)).toEqual([ID, 'x'])
    expect(result.payslips[0]?.member).toBe('Alex')
    expect(result.payslips[0]?.has_document).toBe(true)
    expect(result.payslips[0]?.lines).toHaveLength(1)
  })
})

describe('createPayslip', () => {
  it('upserts the slip and lines under a minted id with the derived year', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const result = await createPayslip(ctx, {
      ...base,
      paid_on: '2026-09-30',
      lines: [
        { kind: 'earning', label: 'Ordinary', amount_cents: 500_000 },
        { kind: 'tax', label: 'PAYG', amount_cents: 120_000, tax_component: 'payg' },
      ],
    })
    expect(result.id).toBe('uuid-1')
    expect(state.rpcCalls[0]?.fn).toBe('upsert_payslip_with_lines')
    const args = state.rpcCalls[0]?.args as {
      p_payslip: Record<string, unknown>
      p_lines: unknown[]
    }
    expect(args.p_payslip).toMatchObject({
      id: 'uuid-1',
      household_id: 'h-1',
      member_id: 'm-self',
      financial_year: 2027,
      file_path: null,
    })
    expect(args.p_lines).toEqual([
      {
        kind: 'earning',
        label: 'Ordinary',
        amount_cents: 500_000,
        source_inflow_id: null,
        tax_component: null,
      },
      {
        kind: 'tax',
        label: 'PAYG',
        amount_cents: 120_000,
        source_inflow_id: null,
        tax_component: 'payg',
      },
    ])
  })

  it('refuses a tax line without a component and a backwards period', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await expect(
      createPayslip(ctx, { ...base, lines: [{ kind: 'tax', label: 'PAYG', amount_cents: 1 }] }),
    ).rejects.toMatchObject({ code: 'invalid_details' })
    await expect(createPayslip(ctx, { ...base, period_start: '2026-10-01' })).rejects.toMatchObject(
      { code: 'invalid_details' },
    )
    expect(state.rpcCalls).toEqual([])
  })

  it('reports a failed write with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members }, rpcError: true })
    await expect(createPayslip(ctx, base)).rejects.toMatchObject({
      code: 'save_failed',
      message: 'The record could not be saved.',
    })
  })
})

describe('updatePayslip', () => {
  it('changes only the given fields and keeps the existing lines', async () => {
    const { ctx, state } = fakeContext({
      tables: { payslip: [slip], payslip_line: [line], members },
    })
    await updatePayslip(ctx, { id: ID, gross_cents: 510_000, paid_on: null })
    const args = state.rpcCalls[0]?.args as {
      p_payslip: Record<string, unknown>
      p_lines: unknown[]
    }
    expect(args.p_payslip).toMatchObject({
      id: ID,
      gross_cents: 510_000,
      net_cents: 380_000,
      paid_on: null,
      financial_year: 2027,
      file_path: null,
    })
    expect(args.p_lines).toHaveLength(1)
  })

  it('replaces lines when given and rejects an unknown id', async () => {
    const { ctx, state } = fakeContext({ tables: { payslip: [slip], payslip_line: [line] } })
    await updatePayslip(ctx, { id: ID, lines: [] })
    const args = state.rpcCalls[0]?.args as { p_lines: unknown[] }
    expect(args.p_lines).toEqual([])
    await expect(
      updatePayslip(ctx, { id: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('deletePayslip', () => {
  it('deletes the row and its document', async () => {
    const { ctx, state } = fakeContext({ tables: { payslip: [slip] } })
    await deletePayslip(ctx, { id: ID })
    expect(state.deletes).toEqual([
      {
        table: 'payslip',
        filters: [
          ['id', ID],
          ['household_id', 'h-1'],
        ],
      },
    ])
    expect(state.removed).toEqual(['h-1/p/old.pdf'])
  })

  it('reports a failed delete and keeps the document', async () => {
    const { ctx, state } = fakeContext({ tables: { payslip: [slip] }, deleteError: true })
    await expect(deletePayslip(ctx, { id: ID })).rejects.toMatchObject({ code: 'save_failed' })
    expect(state.removed).toEqual([])
  })
})

describe('documents', () => {
  const files = { '/tmp/slip.pdf': new Uint8Array([1, 2, 3]) }

  it('attaches by upload then upsert, dropping the old object', async () => {
    const { ctx, state } = fakeContext({
      tables: { payslip: [slip], payslip_line: [line] },
      files,
    })
    await attachPayslipDocument(ctx, { id: ID, file_path: '/tmp/slip.pdf' })
    expect(state.uploadBuckets).toEqual(['payslips'])
    expect(state.uploads[0]).toMatchObject({
      path: `h-1/${ID}/uuid-1-slip.pdf`,
      contentType: 'application/pdf',
    })
    const args = state.rpcCalls[0]?.args as { p_payslip: Record<string, unknown> }
    expect(args.p_payslip.file_path).toBe(`h-1/${ID}/uuid-1-slip.pdf`)
    expect(state.removed).toEqual(['h-1/p/old.pdf'])
  })

  it('accepts base64 content and deletes the upload when the save fails', async () => {
    const { ctx, state } = fakeContext({ tables: { payslip: [slip] }, rpcError: true })
    await expect(
      attachPayslipDocument(ctx, { id: ID, filename: 'a.pdf', content: 'AQID' }),
    ).rejects.toMatchObject({ code: 'save_failed' })
    expect(state.removed).toEqual([`h-1/${ID}/uuid-1-a.pdf`])
    const bad = fakeContext({ tables: { payslip: [slip] } })
    await expect(
      attachPayslipDocument(bad.ctx, { id: ID, filename: 'a.pdf', content: '!!' }),
    ).rejects.toMatchObject({ code: 'invalid_content' })
  })

  it('removes a document by clearing the column then the object', async () => {
    const { ctx, state } = fakeContext({ tables: { payslip: [slip] } })
    await removePayslipDocument(ctx, { id: ID })
    expect(state.updates[0]).toMatchObject({ table: 'payslip', row: { file_path: null } })
    expect(state.removed).toEqual(['h-1/p/old.pdf'])
  })

  it('creates from a document, reading what is not given', async () => {
    const { ctx, state } = fakeContext({
      tables: { members },
      files,
      invoke: {
        data: {
          model: 'm',
          fields: { ...base, paid_on: '2026-09-30', gross_cents: 1 },
          lines: {
            earnings: [{ label: 'Ordinary', amount_cents: 500_000 }],
            tax: [{ label: 'PAYG', amount_cents: 120_000, component: null }],
          },
        },
      },
    })
    const result = await createPayslipFromDocument(ctx, {
      file_path: '/tmp/slip.pdf',
      gross_cents: 500_000,
    })
    expect(state.invocations[0]).toEqual({
      fn: 'payslip-extract',
      body: { path: `h-1/uuid-1/uuid-2-slip.pdf`, financialYear: 2027 },
    })
    expect(result.gross_cents).toBe(500_000)
    expect(result.paid_on).toBe('2026-09-30')
    expect(result.fields_read_from_document).toContain('net_cents')
    expect(result.fields_read_from_document).not.toContain('gross_cents')
    expect(result.lines_read_from_document.earnings).toHaveLength(1)
    const args = state.rpcCalls[0]?.args as {
      p_payslip: Record<string, unknown>
      p_lines: unknown[]
    }
    expect(args.p_payslip.file_path).toBe('h-1/uuid-1/uuid-2-slip.pdf')
    expect(args.p_lines).toEqual([])
  })

  it('skips reading when every figure is given', async () => {
    const { ctx, state } = fakeContext({ tables: { members }, files })
    await createPayslipFromDocument(ctx, { file_path: '/tmp/slip.pdf', ...base })
    expect(state.invocations).toEqual([])
    expect(state.rpcCalls).toHaveLength(1)
  })

  it.each([
    [{ status: 422, body: { notPayslip: true, error: 'upstream' } }, 'extraction_not_payslip'],
    [{ status: 503, body: { configured: false } }, 'extraction_unavailable'],
    [{ status: 415, body: { code: 'unsupported_type' } }, 'extraction_unsupported_type'],
    [{ status: 500, body: { error: 'secret' } }, 'extraction_failed'],
  ] as const)('maps %j to %s and deletes the upload', async (failure, code) => {
    const { ctx, state } = fakeContext({ tables: { members }, files, invoke: { failure } })
    const error = await createPayslipFromDocument(ctx, { file_path: '/tmp/slip.pdf' }).catch(
      (e: unknown) => e,
    )
    expect(error).toMatchObject({ code })
    expect(JSON.stringify(error)).not.toContain('secret')
    expect(state.removed).toEqual(['h-1/uuid-1/uuid-2-slip.pdf'])
    expect(state.rpcCalls).toEqual([])
  })

  it('names missing details and refuses an unreadable type without figures', async () => {
    const partial = fakeContext({
      tables: { members },
      files,
      invoke: { data: { model: 'm', fields: { period_start: '2026-09-14' } } },
    })
    await expect(
      createPayslipFromDocument(partial.ctx, { file_path: '/tmp/slip.pdf' }),
    ).rejects.toMatchObject({ code: 'incomplete_details' })
    const text = fakeContext({ tables: { members }, files: { '/tmp/a.txt': new Uint8Array([1]) } })
    await expect(
      createPayslipFromDocument(text.ctx, { file_path: '/tmp/a.txt' }),
    ).rejects.toMatchObject({ code: 'extraction_unsupported_type' })
    expect(text.state.invocations).toEqual([])
  })

  it('reports an unreadable path and a failed upload with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    await expect(createPayslipFromDocument(ctx, { file_path: '/nope.pdf' })).rejects.toMatchObject({
      code: 'file_unreadable',
    })
    const failing = fakeContext({ tables: { members }, files, uploadError: true })
    await expect(
      createPayslipFromDocument(failing.ctx, { file_path: '/tmp/slip.pdf' }),
    ).rejects.toMatchObject({ code: 'upload_failed' })
  })
})
