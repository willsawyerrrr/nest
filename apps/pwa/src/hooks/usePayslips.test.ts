import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayslip } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { usePayslips, type PayslipInput } from './usePayslips'

const { builder, bucket, invoke } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    bucket: { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
    invoke: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => bucket) },
    functions: { invoke },
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

/** A document already uploaded for a payslip, as a form would hand it over. */
const attachment = { payslipId: 'ps1', path: 'h1/ps1/uuid-slip.pdf' }

/** A non-2xx reply from `payslip-extract`, as `invoke` reports one. */
function httpFailure(status: number, body: unknown) {
  return {
    data: null,
    error: new Error(`status ${status}`),
    response: new Response(JSON.stringify(body), { status }),
  }
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
  invoke.mockResolvedValue({ data: null, error: null, response: undefined })
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

  it('files an uploaded document under the household and payslip', async () => {
    const result = await renderPayslips()
    const file = slipFile()

    const stored = await result.current.attachments.upload('ps9', file)

    const [path, uploaded] = bucket.upload.mock.calls[0]!
    expect(path).toBe(stored.path)
    expect(path).toMatch(/^h1\/ps9\/[\w-]+-slip\.pdf$/)
    expect(uploaded).toBe(file)
    expect(stored.payslipId).toBe('ps9')
  })

  it('reports an upload failure rather than a path nothing was written to', async () => {
    bucket.upload.mockResolvedValue({ data: null, error: new Error('nope') })
    const result = await renderPayslips()

    await expect(result.current.attachments.upload('ps9', slipFile())).rejects.toThrow('nope')
  })

  it('inserts the row under the id its uploaded document is filed against', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.create(input, attachment)
    })

    expect(bucket.upload).not.toHaveBeenCalled()
    expect(builder.insert).toHaveBeenCalledWith({
      ...input,
      id: 'ps1',
      file_path: 'h1/ps1/uuid-slip.pdf',
      household_id: 'h1',
    })
  })

  it('deletes an abandoned upload, and shrugs off a delete that fails', async () => {
    const result = await renderPayslips()

    await result.current.attachments.discard('h1/ps1/uuid-slip.pdf')
    expect(bucket.remove).toHaveBeenCalledWith(['h1/ps1/uuid-slip.pdf'])

    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    await expect(
      result.current.attachments.discard('h1/ps1/uuid-slip.pdf'),
    ).resolves.toBeUndefined()
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
      await result.current.update('ps1', input, attachment)
    })

    expect(builder.update).toHaveBeenCalledWith({ ...input, file_path: attachment.path })
    expect(bucket.remove).toHaveBeenCalledWith(['h1/ps1/old-slip.pdf'])
  })

  it('attaches a document to a payslip that had none', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.update('ps1', input, attachment)
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

describe('usePayslips attachment extraction', () => {
  it('reads an uploaded slip through payslip-extract', async () => {
    const extraction = {
      model: 'claude-haiku-4-5-20251001',
      fields: { gross_cents: 4_120_50 },
      text: { gross: '4,120.50' },
      missing: [],
      unreadable: [],
    }
    invoke.mockResolvedValue({ data: extraction, error: null, response: undefined })
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'read',
      extraction,
    })
    expect(invoke).toHaveBeenCalledWith('payslip-extract', {
      body: { path: 'h1/ps1/slip.pdf' },
    })
  })

  it('reports an unset API key as the feature being off, not broken', async () => {
    invoke.mockResolvedValue(
      httpFailure(503, {
        error: 'Payslip extraction is not configured. Enter the figures by hand.',
        configured: false,
      }),
    )
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'not-configured',
      message: 'Payslip extraction is not configured. Enter the figures by hand.',
    })
  })

  it('passes on the model’s reason for refusing a file that is not a payslip', async () => {
    invoke.mockResolvedValue(
      httpFailure(422, {
        error: 'That file does not look like a payslip.',
        notPayslip: true,
        reason: 'It is a bank statement.',
      }),
    )
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'not-payslip',
      message: 'That file does not look like a payslip.',
      reason: 'It is a bank statement.',
    })
  })

  it('surfaces the function’s own message for a size, type, or model failure', async () => {
    const result = await renderPayslips()

    for (const [status, error] of [
      [413, 'That file is too large to read (24.0 MB; the limit is 20.0 MB).'],
      [415, 'That file type cannot be read. Upload a PDF, JPEG, PNG, or WebP.'],
      [429, 'Reading payslips is rate limited right now. Try again shortly.'],
      [502, 'The payslip could not be read. Enter the figures by hand.'],
      [504, 'Reading the payslip took too long. Try again, or enter it by hand.'],
    ] as const) {
      invoke.mockResolvedValue(httpFailure(status, { error }))
      expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
        status: 'failed',
        message: error,
      })
    }
  })

  it('falls back to a plain message when the failure carries no readable body', async () => {
    const result = await renderPayslips()

    invoke.mockResolvedValue({
      data: null,
      error: new Error('bad gateway'),
      response: new Response('<html>502</html>', { status: 502 }),
    })
    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'failed',
      message: 'Could not read this payslip. Enter the figures by hand.',
    })

    // A network failure never reaches the function, so it carries no response.
    invoke.mockResolvedValue({ data: null, error: new Error('offline'), response: undefined })
    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'failed',
      message: 'Could not read this payslip. Enter the figures by hand.',
    })

    // A 2xx with no body is no extraction either.
    invoke.mockResolvedValue({ data: null, error: null, response: undefined })
    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'failed',
      message: 'Could not read this payslip. Enter the figures by hand.',
    })
  })
})
