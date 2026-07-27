import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayslip } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { usePayslips, type PayslipInput } from './usePayslips'

const { builder, bucket } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    bucket: { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => bucket) },
  },
}))

const payslip = makePayslip()

const input: PayslipInput = {
  member_id: 'm1',
  financial_year: 2027,
  period_start: '2026-07-01',
  period_end: '2026-07-14',
  paid_on: '2026-07-15',
  gross_cents: 5_000_00,
  tax_withheld_cents: 1_000_00,
  super_cents: 600_00,
  net_cents: 4_000_00,
  salary_sacrifice_cents: null,
  ytd_gross_cents: null,
  ytd_tax_withheld_cents: null,
  ytd_super_cents: null,
  source_inflow_id: 'i1',
  note: null,
}

/** A payslip document as a `File`, for the attachment paths. */
function slipFile() {
  return new File(['x'], 'slip.pdf', { type: 'application/pdf' })
}

/** Renders the hook and waits for its first load to settle. */
async function renderPayslips(financialYear?: number) {
  const { result } = renderHook(
    () => (financialYear === undefined ? usePayslips('h1') : usePayslips('h1', financialYear)),
    { wrapper: makeWrapper() },
  )
  await waitFor(() => expect(result.current.payslips).not.toBeNull())
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [payslip], error: null }
  bucket.upload.mockResolvedValue({ data: {}, error: null })
  bucket.remove.mockResolvedValue({ data: {}, error: null })
  bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/y' }, error: null })
})

describe('usePayslips', () => {
  it('loads the financial year’s payslips, most recent pay period first', async () => {
    const result = await renderPayslips()

    expect(result.current.payslips).toEqual([payslip])
    expect(result.current.loading).toBe(false)
    expect(result.current.financialYear).toBeGreaterThan(2000)
    expect(builder.eq).toHaveBeenCalledWith('financial_year', result.current.financialYear)
    expect(builder.order).toHaveBeenCalledWith('period_end', { ascending: false })
  })

  it('scopes to an explicit financial year when given one', async () => {
    const result = await renderPayslips(2025)

    expect(result.current.financialYear).toBe(2025)
    expect(builder.eq).toHaveBeenCalledWith('financial_year', 2025)
  })

  it('inserts a payslip under the household with no attachment', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.create(input)
    })

    expect(bucket.upload).not.toHaveBeenCalled()
    expect(builder.insert).toHaveBeenCalledWith({
      ...input,
      id: expect.any(String),
      file_path: null,
      household_id: 'h1',
    })
  })

  it('uploads the attachment under the household and payslip before inserting', async () => {
    const result = await renderPayslips()
    const file = slipFile()

    await act(async () => {
      await result.current.create(input, file)
    })

    const [path, uploaded] = bucket.upload.mock.calls[0]!
    expect(path).toMatch(/^h1\/[\w-]+\/.*-slip\.pdf$/)
    expect(uploaded).toBe(file)
    const inserted = builder.insert.mock.calls[0]![0] as { id: string; file_path: string }
    expect(inserted.file_path).toBe(path)
    expect(path).toContain(`h1/${inserted.id}/`)
  })

  it('records no row when the attachment upload fails', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: new Error('nope') })
    const result = await renderPayslips()

    await expect(result.current.create(input, slipFile())).rejects.toThrow('nope')
    expect(builder.insert).not.toHaveBeenCalled()
  })

  it('rewrites a payslip, leaving an existing attachment alone', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.update('ps1', input)
    })

    expect(builder.update).toHaveBeenCalledWith(input)
    expect(bucket.upload).not.toHaveBeenCalled()
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('replaces an attachment and drops the superseded object', async () => {
    builder.result = { data: [makePayslip({ file_path: 'h1/ps1/old-slip.pdf' })], error: null }
    const result = await renderPayslips()

    await act(async () => {
      await result.current.update('ps1', input, slipFile())
    })

    const [path] = bucket.upload.mock.calls[0]!
    expect(builder.update).toHaveBeenCalledWith({ ...input, file_path: path })
    expect(bucket.remove).toHaveBeenCalledWith(['h1/ps1/old-slip.pdf'])
  })

  it('attaches a document to a payslip that had none', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.update('ps1', input, slipFile())
    })

    expect(builder.update).toHaveBeenCalled()
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('removes a payslip and its stored attachment', async () => {
    builder.result = { data: [makePayslip({ file_path: 'h1/ps1/slip.pdf' })], error: null }
    const result = await renderPayslips()

    await act(async () => {
      await result.current.remove('ps1')
    })

    expect(bucket.remove).toHaveBeenCalledWith(['h1/ps1/slip.pdf'])
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'ps1')
  })

  it('removes a payslip with no attachment without touching Storage', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.remove('ps1')
      await result.current.reload()
    })

    expect(bucket.remove).not.toHaveBeenCalled()
    expect(builder.delete).toHaveBeenCalled()
  })

  it('keeps the row when removing its stored attachment fails', async () => {
    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    builder.result = { data: [makePayslip({ file_path: 'h1/ps1/slip.pdf' })], error: null }
    const result = await renderPayslips()

    await expect(result.current.remove('ps1')).rejects.toThrow('nope')
    expect(builder.delete).not.toHaveBeenCalled()
  })

  it('returns a signed URL for a stored attachment', async () => {
    const result = await renderPayslips()

    expect(await result.current.signedUrl('h1/ps1/slip.pdf')).toBe('https://x/y')
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('h1/ps1/slip.pdf', 3600)
  })

  it('returns null when signing the URL fails', async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: new Error('nope') })
    const result = await renderPayslips()

    expect(await result.current.signedUrl('h1/ps1/slip.pdf')).toBeNull()
  })
})
