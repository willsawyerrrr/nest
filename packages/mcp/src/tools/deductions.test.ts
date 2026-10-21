import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import {
  addDeduction,
  attachReceiptFromContent,
  attachReceiptFromFile,
  deleteDeduction,
  listDeductions,
  removeReceipt,
  updateDeduction,
  workUseAmountCents,
} from './deductions.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const GROUP = '2c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f'
const DONATIONS = '3d8e9f0a-1b2c-4d3e-9f4a-5b6c7d8e9f0a'

const deduction = {
  id: ID,
  household_id: 'h-1',
  member_id: 'm-self',
  description: 'Laptop',
  amount_cents: 600_00,
  full_amount_cents: 1_000_00,
  work_use_percent: 60,
  deduction_date: '2026-10-01',
  financial_year: 2027,
  basis: 'amount',
  category: 'work_expense',
  distance_km: null,
  work_from_home_hours: null,
  group_id: null,
}

const group = {
  id: GROUP,
  household_id: 'h-1',
  member_id: 'm-self',
  financial_year: 2027,
  name: 'Adobe',
  kind: 'standard',
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('workUseAmountCents', () => {
  it('rounds the claimed share to the nearest cent', () => {
    expect(workUseAmountCents(1_000_00, 60)).toBe(600_00)
    expect(workUseAmountCents(33, 50)).toBe(17)
    expect(workUseAmountCents(1_000_00, 33.33)).toBe(333_30)
  })
})

describe('listDeductions', () => {
  it('lists the year with group names and receipt presence, filtered by category', async () => {
    const { ctx } = fakeContext({
      tables: {
        members,
        deduction: [
          { ...deduction, group_id: GROUP },
          { ...deduction, id: 'd-2', category: 'donation', deduction_date: '2026-09-01' },
          { ...deduction, id: 'd-3', financial_year: 2026 },
        ],
        deduction_group: [group],
        deduction_receipt: [{ deduction_id: ID }],
      },
    })
    const all = (await listDeductions(ctx, {})) as { id: string }[]
    expect(all.map((row) => row.id)).toEqual(['d-2', ID])
    const donations = await listDeductions(ctx, { category: 'donation' })
    expect(donations).toHaveLength(1)
    expect((await listDeductions(ctx, { financial_year: 2027, member: 'alex' }))[1]).toMatchObject({
      group: 'Adobe',
      has_receipt: true,
      member: 'Alex',
    })
  })
})

describe('addDeduction', () => {
  const base = {
    category: 'work_expense',
    basis: 'amount',
    description: 'Laptop',
    deduction_date: '2026-10-01',
  } as const

  it('apportions the full cost by work use', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const result = await addDeduction(ctx, {
      ...base,
      amount_cents: 1_000_00,
      work_use_percent: 60,
    })
    expect(state.rpcCalls).toEqual([
      {
        fn: 'create_deduction_with_receipt',
        args: {
          p_deduction: {
            id: 'uuid-1',
            household_id: 'h-1',
            member_id: 'm-self',
            description: 'Laptop',
            deduction_date: '2026-10-01',
            financial_year: 2027,
            category: 'work_expense',
            basis: 'amount',
            group_id: null,
            amount_cents: 600_00,
            full_amount_cents: 1_000_00,
            work_use_percent: 60,
            distance_km: null,
            work_from_home_hours: null,
          },
        },
      },
    ])
    expect(result).toMatchObject({ id: 'uuid-1', amount_cents: 600_00, warning: null })
  })

  it('snapshots the cents-per-km rate and warns past the cap', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const result = await addDeduction(ctx, { ...base, basis: 'distance', distance_km: 1_000 })
    const sent = (state.rpcCalls[0]!.args.p_deduction ?? {}) as Record<string, unknown>
    expect(sent).toMatchObject({ basis: 'distance', distance_km: 1_000, work_use_percent: 100 })
    expect(Number.isInteger(sent.amount_cents)).toBe(true)
    expect(sent.amount_cents).toBe(sent.full_amount_cents)
    expect(result.warning).toBeNull()
    const over = await addDeduction(ctx, { ...base, basis: 'distance', distance_km: 100_000 })
    expect(over.warning).toMatch(/caps this method/)
  })

  it('prices hours at the fixed rate', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addDeduction(ctx, { ...base, basis: 'hours', work_from_home_hours: 100 })
    expect(state.rpcCalls[0]!.args.p_deduction).toMatchObject({
      basis: 'hours',
      work_from_home_hours: 100,
      amount_cents: 70_00,
    })
  })

  it('refuses figures that do not fit the basis, category, or year', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    const codes = async (input: Parameters<typeof addDeduction>[1]) =>
      (await failure(addDeduction(ctx, input))).code
    expect(await codes({ ...base })).toBe('invalid_details')
    expect(await codes({ ...base, amount_cents: 1, distance_km: 5 })).toBe('invalid_details')
    expect(await codes({ ...base, basis: 'distance' })).toBe('invalid_details')
    expect(await codes({ ...base, basis: 'distance', distance_km: 5, amount_cents: 1 })).toBe(
      'invalid_details',
    )
    expect(await codes({ ...base, basis: 'hours', distance_km: 5 })).toBe('invalid_details')
    expect(
      await codes({ ...base, category: 'donation', amount_cents: 5, work_use_percent: 50 }),
    ).toBe('invalid_details')
    expect(
      await codes({ ...base, category: 'tax_agent_fees', basis: 'hours', work_from_home_hours: 5 }),
    ).toBe('invalid_details')
    expect(
      await codes({
        ...base,
        basis: 'hours',
        work_from_home_hours: 5,
        deduction_date: '2030-01-01',
      }),
    ).toBe('invalid_details')
  })

  it('files a payment only in a standard group of the same member and year', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        members,
        deduction_group: [
          group,
          { ...group, id: 'g-year', financial_year: 2026 },
          { ...group, id: 'g-other', member_id: 'm-other' },
          { ...group, id: DONATIONS, kind: 'donations' },
        ],
      },
    })
    const input = { ...base, amount_cents: 20_00 }
    await addDeduction(ctx, { ...input, group_id: GROUP })
    expect(state.rpcCalls[0]!.args.p_deduction).toMatchObject({ group_id: GROUP })
    expect((await failure(addDeduction(ctx, { ...input, group_id: 'g-year' }))).code).toBe(
      'invalid_details',
    )
    expect((await failure(addDeduction(ctx, { ...input, group_id: 'g-other' }))).code).toBe(
      'invalid_details',
    )
    expect((await failure(addDeduction(ctx, { ...input, group_id: DONATIONS }))).code).toBe(
      'automatic_group',
    )
    expect(
      (await failure(addDeduction(ctx, { ...input, category: 'donation', group_id: GROUP }))).code,
    ).toBe('automatic_group')
    expect((await failure(addDeduction(ctx, { ...input, group_id: 'missing' }))).code).toBe(
      'not_found',
    )
  })

  it('reports a stable save failure', async () => {
    const { ctx } = fakeContext({ tables: { members }, rpcError: true })
    const error = await failure(addDeduction(ctx, { ...base, amount_cents: 1_00 }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateDeduction', () => {
  it('recomputes the claim from the full cost and work use', async () => {
    const { ctx, state } = fakeContext({ tables: { deduction: [deduction] } })
    const result = await updateDeduction(ctx, { id: ID, work_use_percent: 50 })
    expect(state.updates).toEqual([
      {
        table: 'deduction',
        row: {
          description: 'Laptop',
          deduction_date: '2026-10-01',
          financial_year: 2027,
          group_id: null,
          amount_cents: 500_00,
          full_amount_cents: 1_000_00,
          work_use_percent: 50,
          distance_km: null,
          work_from_home_hours: null,
        },
        filters: [
          ['id', ID],
          ['household_id', 'h-1'],
        ],
      },
    ])
    expect(result).toMatchObject({ amount_cents: 500_00, basis: 'amount' })
  })

  it('reprices a distance claim at the year of the new date and refuses stray inputs', async () => {
    const row = { ...deduction, basis: 'distance', distance_km: 100, work_use_percent: 100 }
    const { ctx, state } = fakeContext({ tables: { deduction: [row] } })
    await updateDeduction(ctx, { id: ID, distance_km: 200, deduction_date: '2026-06-30' })
    expect(state.updates[0]!.row).toMatchObject({ distance_km: 200, financial_year: 2026 })
    expect((await failure(updateDeduction(ctx, { id: ID, amount_cents: 5 }))).code).toBe(
      'invalid_details',
    )
  })

  it('moves a payment between groups and refuses crossing years while grouped', async () => {
    const grouped = { ...deduction, group_id: GROUP }
    const { ctx, state } = fakeContext({
      tables: { deduction: [grouped], deduction_group: [group] },
    })
    await updateDeduction(ctx, { id: ID, group_id: null })
    expect(state.updates[0]!.row).toMatchObject({ group_id: null })
    expect(
      (await failure(updateDeduction(ctx, { id: ID, deduction_date: '2026-06-30' }))).code,
    ).toBe('invalid_details')
  })

  it('keeps a donation in its automatic group and lets it refile on a new year', async () => {
    const donation = {
      ...deduction,
      category: 'donation',
      work_use_percent: 100,
      amount_cents: 50_00,
      full_amount_cents: 50_00,
      group_id: DONATIONS,
    }
    const { ctx, state } = fakeContext({
      tables: {
        deduction: [donation],
        deduction_group: [{ ...group, id: DONATIONS, kind: 'donations' }],
      },
    })
    expect((await failure(updateDeduction(ctx, { id: ID, group_id: GROUP }))).code).toBe(
      'automatic_group',
    )
    await updateDeduction(ctx, { id: ID, deduction_date: '2026-06-30' })
    expect(state.updates[0]!.row).toMatchObject({ group_id: null, financial_year: 2026 })
  })

  it('answers not_found and save_failed with fixed copy', async () => {
    const missing = fakeContext()
    expect((await failure(updateDeduction(missing.ctx, { id: ID }))).code).toBe('not_found')
    const { ctx } = fakeContext({ tables: { deduction: [deduction] }, updateError: true })
    const error = await failure(updateDeduction(ctx, { id: ID, description: 'x' }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('deleteDeduction', () => {
  it('deletes the deduction and discards its stored receipt', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        deduction: [deduction],
        deduction_receipt: [{ deduction_id: ID, storage_path: 'h-1/d/r.pdf' }],
      },
    })
    expect(await deleteDeduction(ctx, { id: ID })).toEqual({ id: ID, deleted: true })
    expect(state.deletes).toEqual([
      {
        table: 'deduction',
        filters: [
          ['id', ID],
          ['household_id', 'h-1'],
        ],
      },
    ])
    expect(state.removed).toEqual(['h-1/d/r.pdf'])
  })

  it('refuses an unknown id and reports a failed delete', async () => {
    expect((await failure(deleteDeduction(fakeContext().ctx, { id: ID }))).code).toBe('not_found')
    const { ctx, state } = fakeContext({ tables: { deduction: [deduction] }, deleteError: true })
    expect((await failure(deleteDeduction(ctx, { id: ID }))).code).toBe('delete_failed')
    expect(state.removed).toEqual([])
  })
})

describe('receipts', () => {
  const bytes = new Uint8Array([1, 2, 3])

  it('attaches a first receipt under the household and deduction', async () => {
    const { ctx, state } = fakeContext({
      tables: { deduction: [deduction] },
      files: { '/tmp/Receipt 1.pdf': bytes },
    })
    expect(await attachReceiptFromFile(ctx, { id: ID, file_path: '/tmp/Receipt 1.pdf' })).toEqual({
      id: ID,
      has_receipt: true,
      replaced: false,
    })
    expect(state.uploadBuckets).toEqual(['receipts'])
    expect(state.uploads).toEqual([
      { path: `h-1/${ID}/uuid-1-Receipt_1.pdf`, contentType: 'application/pdf', bytes: 3 },
    ])
    expect(state.inserts).toEqual([
      {
        table: 'deduction_receipt',
        row: {
          household_id: 'h-1',
          deduction_id: ID,
          storage_path: `h-1/${ID}/uuid-1-Receipt_1.pdf`,
        },
      },
    ])
  })

  it('replaces an existing receipt and deletes the old object', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        deduction: [deduction],
        deduction_receipt: [{ id: 'r-1', deduction_id: ID, storage_path: 'h-1/old.pdf' }],
      },
    })
    const result = await attachReceiptFromContent(ctx, {
      id: ID,
      filename: 'new.png',
      content: 'AQID',
    })
    expect(result.replaced).toBe(true)
    expect(state.uploads[0]!.contentType).toBe('image/png')
    expect(state.updates[0]).toMatchObject({
      table: 'deduction_receipt',
      row: { storage_path: `h-1/${ID}/uuid-1-new.png` },
    })
    expect(state.removed).toEqual(['h-1/old.pdf'])
  })

  it('stores an unreadable type as an octet stream', async () => {
    const { ctx, state } = fakeContext({ tables: { deduction: [deduction] } })
    await attachReceiptFromContent(ctx, { id: ID, filename: 'page.html', content: 'AQID' })
    expect(state.uploads[0]!.contentType).toBe('application/octet-stream')
  })

  it('fails with stable codes and cleans up after a failed save', async () => {
    const tables = { deduction: [deduction] }
    expect(
      (
        await failure(
          attachReceiptFromFile(fakeContext({ tables }).ctx, { id: ID, file_path: '/nope' }),
        )
      ).code,
    ).toBe('file_unreadable')
    expect(
      (
        await failure(
          attachReceiptFromContent(fakeContext({ tables }).ctx, {
            id: ID,
            filename: 'a.pdf',
            content: '***',
          }),
        )
      ).code,
    ).toBe('invalid_content')
    expect(
      (
        await failure(
          attachReceiptFromContent(fakeContext().ctx, {
            id: ID,
            filename: 'a.pdf',
            content: 'AQID',
          }),
        )
      ).code,
    ).toBe('not_found')
    expect(
      (
        await failure(
          attachReceiptFromContent(fakeContext({ tables, uploadError: true }).ctx, {
            id: ID,
            filename: 'a.pdf',
            content: 'AQID',
          }),
        )
      ).code,
    ).toBe('upload_failed')
    const { ctx, state } = fakeContext({ tables, insertError: true })
    expect(
      (await failure(attachReceiptFromContent(ctx, { id: ID, filename: 'a.pdf', content: 'AQID' })))
        .code,
    ).toBe('save_failed')
    expect(state.removed).toEqual([`h-1/${ID}/uuid-1-a.pdf`])
  })

  it('removes a receipt row and file, and is idempotent when there is none', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        deduction: [deduction],
        deduction_receipt: [{ deduction_id: ID, storage_path: 'h-1/old.pdf' }],
      },
    })
    expect(await removeReceipt(ctx, { id: ID })).toEqual({ id: ID, has_receipt: false })
    expect(state.deletes[0]).toMatchObject({ table: 'deduction_receipt' })
    expect(state.removed).toEqual(['h-1/old.pdf'])
    const none = fakeContext({ tables: { deduction: [deduction] } })
    expect(await removeReceipt(none.ctx, { id: ID })).toEqual({ id: ID, has_receipt: false })
    expect(none.state.deletes).toEqual([])
  })
})
