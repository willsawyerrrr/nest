import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePayslip } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { usePayslips, type PayslipInput, type PayslipSubmission } from './usePayslips'

const { builder, bucket, invoke, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
    bucket: { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() },
    invoke: vi.fn(),
    rpc: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => bucket) },
    functions: { invoke },
    rpc,
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
  note: null,
}

/** A payslip document as a `File`, for the attachment paths. */
function slipFile() {
  return new File(['x'], 'slip.pdf', { type: 'application/pdf' })
}

/** A document already uploaded for a payslip, as a form would hand it over. */
const attachment = { payslipId: 'ps1', path: 'h1/ps1/uuid-slip.pdf' }

/** One itemised slip as a form submits it, under the id the form minted. */
const submission: PayslipSubmission = {
  id: 'ps1',
  input,
  lines: [
    {
      kind: 'earning',
      source_inflow_id: 'i1',
      tax_component: null,
      label: 'Ordinary Hours',
      amount_cents: 5_000_00,
    },
  ],
  attachment: null,
}

/** What the RPC should have been sent for `submission`, with `file_path` on top. */
function rpcArgs(filePath: string | null) {
  return {
    p_payslip: { ...input, id: 'ps1', household_id: 'h1', file_path: filePath },
    p_lines: [...submission.lines],
  }
}

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
  rpc.mockResolvedValue({ data: 'ps1', error: null })
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

  it('writes a payslip and its earnings lines in one call', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.save(submission)
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(null))
    expect(bucket.upload).not.toHaveBeenCalled()
  })

  it('surfaces a failed save without writing the lines separately', async () => {
    // The slip and its lines move together or not at all: a rejection is one
    // failed call, never a slip left behind without the lines it was saved with.
    rpc.mockResolvedValue({ data: null, error: new Error('nope') })
    const result = await renderPayslips()

    await expect(result.current.save(submission)).rejects.toThrow('nope')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('rewrites the same slip when a failed save is retried', async () => {
    // The id is the submission's, so pressing Save again after a failure lands
    // on the row the first attempt would have written, not a second one beside it.
    rpc.mockResolvedValueOnce({ data: null, error: new Error('nope') })
    const result = await renderPayslips()

    await expect(result.current.save(submission)).rejects.toThrow('nope')
    await act(async () => {
      await result.current.save(submission)
    })

    expect(
      rpc.mock.calls.map(([, args]) => (args as { p_payslip: { id: string } }).p_payslip.id),
    ).toEqual(['ps1', 'ps1'])
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

  it('writes the row under the id its uploaded document is filed against', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.save({ ...submission, attachment })
    })

    expect(bucket.upload).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(attachment.path))
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
      await result.current.save(submission)
    })

    // A null path is what leaves the stored document in place.
    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(null))
    expect(bucket.upload).not.toHaveBeenCalled()
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('replaces an attachment and drops the superseded object', async () => {
    builder.result = { data: [makePayslip({ file_path: 'h1/ps1/old-slip.pdf' })], error: null }
    const result = await renderPayslips()

    await act(async () => {
      await result.current.save({ ...submission, attachment })
    })

    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(attachment.path))
    expect(bucket.remove).toHaveBeenCalledWith(['h1/ps1/old-slip.pdf'])
  })

  it('keeps a save that dropping the superseded document failed after', async () => {
    // The row already points at the new object, so failing to tidy the old one
    // must not reject a save that has happened — the form would then treat the
    // stored document as an orphan and delete the one the row references.
    bucket.remove.mockResolvedValue({ data: null, error: new Error('nope') })
    builder.result = { data: [makePayslip({ file_path: 'h1/ps1/old-slip.pdf' })], error: null }
    const result = await renderPayslips()

    await act(async () => {
      await expect(result.current.save({ ...submission, attachment })).resolves.toBeUndefined()
    })

    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(attachment.path))
    expect(bucket.remove).toHaveBeenCalledWith(['h1/ps1/old-slip.pdf'])
  })

  it('leaves the document alone when the same save runs a second time', async () => {
    // A retry reads the path the first save committed as the superseded one.
    builder.result = { data: [makePayslip({ file_path: attachment.path })], error: null }
    const result = await renderPayslips()

    await act(async () => {
      await result.current.save({ ...submission, attachment })
    })

    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(attachment.path))
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('attaches a document to a payslip that had none', async () => {
    const result = await renderPayslips()

    await act(async () => {
      await result.current.save({ ...submission, attachment })
    })

    expect(rpc).toHaveBeenCalledWith('upsert_payslip_with_lines', rpcArgs(attachment.path))
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
    invoke.mockResolvedValue({
      data: {
        model: 'claude-haiku-4-5-20251001',
        fields: { gross_cents: 4_120_50 },
        // The reply's record of what was read: the form pre-fills from the fields
        // and the lines, and carries none of the rest in.
        text: { gross: '4,120.50' },
        lines: {
          earnings: [{ label: 'Ordinary Hours', amount: '$4,120.50', amount_cents: 4_120_50 }],
          tax: [],
        },
        missing: [],
        unreadable: [],
      },
      error: null,
      response: undefined,
    })
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'read',
      extraction: {
        model: 'claude-haiku-4-5-20251001',
        fields: { gross_cents: 4_120_50 },
        lines: { earnings: [{ label: 'Ordinary Hours', amount_cents: 4_120_50 }], tax: [] },
      },
    })
    expect(invoke).toHaveBeenCalledWith('payslip-extract', {
      body: { path: 'h1/ps1/slip.pdf' },
    })
  })

  it('leaves a negative amount unfilled, for the member to type off the slip', async () => {
    invoke.mockResolvedValue({
      data: {
        model: 'claude-haiku-4-5-20251001',
        fields: { gross_cents: 4_120_50, tax_withheld_cents: -1_048_00 },
        text: { gross: '4,120.50', tax_withheld: '(1,048.00)' },
        lines: {
          // A line reversing an overpayment keeps its sign: the column takes one.
          earnings: [{ label: 'Overpayment recovery', amount: '($120.00)', amount_cents: -120_00 }],
          tax: [],
        },
        missing: [],
        unreadable: [],
      },
      error: null,
      response: undefined,
    })
    const result = await renderPayslips()

    const outcome = await result.current.attachments.read('h1/ps1/slip.pdf')

    expect(outcome).toEqual({
      status: 'read',
      extraction: {
        model: 'claude-haiku-4-5-20251001',
        fields: { gross_cents: 4_120_50 },
        lines: { earnings: [{ label: 'Overpayment recovery', amount_cents: -120_00 }], tax: [] },
      },
    })
  })

  it('reads a 200 body the form could not render as a plain failure', async () => {
    invoke.mockResolvedValue({ data: { unexpected: true }, error: null, response: undefined })
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'failed',
      message: 'Could not read this payslip. Enter the figures by hand.',
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

  it('reports an account out of credit as its own switched-off state', async () => {
    const message =
      'Payslip reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the figures by hand.'
    invoke.mockResolvedValue(httpFailure(503, { error: message, outOfCredit: true }))
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'out-of-credit',
      message,
    })
  })

  it('reports a refused API key as its own switched-off state', async () => {
    const message =
      'Payslip reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the figures by hand.'
    invoke.mockResolvedValue(httpFailure(503, { error: message, keyRejected: true }))
    const result = await renderPayslips()

    expect(await result.current.attachments.read('h1/ps1/slip.pdf')).toEqual({
      status: 'key-rejected',
      message,
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
