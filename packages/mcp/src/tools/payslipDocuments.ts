import { basename } from 'node:path'
import { z } from 'zod'
import { resolveMember, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import {
  canExtract,
  MAX_REMOTE_CONTENT_LENGTH,
  MAX_REMOTE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  storageKeyName,
  storedContentType,
} from '../upload.ts'
import {
  amounts,
  checkLines,
  dateField,
  discardUpload,
  figuresOf,
  linesSchema,
  loadLines,
  loadPayslip,
  noteField,
  optionalAmounts,
  payslipFinancialYear,
  PAYSLIPS_BUCKET,
  save,
  toRpcLine,
  type Figures,
} from './payslips.ts'
import { centsSchema, isoDateSchema } from './write.ts'

export const removePayslipDocumentInput = z.object({ id: z.uuid() })

const documentStdio = { file_path: z.string().trim().min(1) }
const documentRemote = {
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(MAX_REMOTE_CONTENT_LENGTH),
}

const fromDocumentFields = z.object({
  member: z.string().trim().min(1).optional(),
  period_start: dateField.optional(),
  period_end: dateField.optional(),
  paid_on: dateField.optional(),
  gross_cents: amounts.gross_cents.optional(),
  tax_withheld_cents: amounts.tax_withheld_cents.optional(),
  super_cents: amounts.super_cents.optional(),
  net_cents: amounts.net_cents.optional(),
  salary_sacrifice_cents: optionalAmounts.salary_sacrifice_cents.optional(),
  ytd_gross_cents: optionalAmounts.ytd_gross_cents.optional(),
  ytd_tax_withheld_cents: optionalAmounts.ytd_tax_withheld_cents.optional(),
  ytd_super_cents: optionalAmounts.ytd_super_cents.optional(),
  note: noteField.optional(),
  lines: linesSchema.optional(),
})

export const createPayslipFromDocumentInput = fromDocumentFields.extend(documentStdio)
export const createPayslipFromDocumentRemoteInput = fromDocumentFields.extend(documentRemote)
export const attachPayslipDocumentInput = z.object({ id: z.uuid(), ...documentStdio })
export const attachPayslipDocumentRemoteInput = z.object({ id: z.uuid(), ...documentRemote })

interface DocumentInput {
  file_path?: string
  filename?: string
  content?: string
}

/** Reads the document a tool was given: a local file over stdio, base64 content over HTTP. */
async function readDocument(
  ctx: NestContext,
  input: DocumentInput,
): Promise<{ name: string; bytes: Uint8Array }> {
  if (input.file_path !== undefined) {
    let bytes: Uint8Array
    try {
      bytes = await ctx.readFile(input.file_path)
    } catch {
      throw fixedError('file_unreadable')
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw fixedError('file_too_large')
    return { name: basename(input.file_path), bytes }
  }
  const content = (input.content ?? '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) {
    throw fixedError('invalid_content')
  }
  const bytes = Buffer.from(content, 'base64')
  if (bytes.byteLength > MAX_REMOTE_UPLOAD_BYTES) throw fixedError('file_too_large')
  return { name: basename(input.filename ?? 'payslip'), bytes }
}

async function uploadDocument(
  ctx: NestContext,
  payslipId: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = `${ctx.householdId}/${payslipId}/${ctx.randomUUID()}-${storageKeyName(name)}`
  const { error } = await ctx.supabase.storage
    .from(PAYSLIPS_BUCKET)
    .upload(path, bytes, { contentType: storedContentType(name) })
  if (error) throw fixedError('upload_failed')
  return path
}

/** Stores a document against a payslip, replacing any earlier one (the old object is deleted, best effort). */
export async function attachPayslipDocument(
  ctx: NestContext,
  input: DocumentInput & { id: string },
) {
  const row = await loadPayslip(ctx, input.id)
  const { name, bytes } = await readDocument(ctx, input)
  const path = await uploadDocument(ctx, input.id, name, bytes)
  try {
    await save(ctx, input.id, figuresOf(row), path, await loadLines(ctx, input.id))
  } catch (error) {
    await discardUpload(ctx, path)
    throw error
  }
  if (row.file_path !== null) await discardUpload(ctx, row.file_path)
  return { id: input.id, has_document: true }
}

/** Clears a payslip's document and deletes the stored object (best effort). */
export async function removePayslipDocument(
  ctx: NestContext,
  input: z.infer<typeof removePayslipDocumentInput>,
) {
  const row = await loadPayslip(ctx, input.id)
  if (row.file_path !== null) {
    const { error } = await ctx.supabase
      .from('payslip')
      .update({ file_path: null })
      .eq('id', input.id)
      .eq('household_id', ctx.householdId)
    if (error) throw fixedError('save_failed')
    await discardUpload(ctx, row.file_path)
  }
  return { id: input.id, has_document: false }
}

const FIGURE_KEYS = [
  'period_start',
  'period_end',
  'paid_on',
  'gross_cents',
  'tax_withheld_cents',
  'super_cents',
  'net_cents',
  'salary_sacrifice_cents',
  'ytd_gross_cents',
  'ytd_tax_withheld_cents',
  'ytd_super_cents',
] as const

type FigureKey = (typeof FIGURE_KEYS)[number]
type FigureValues = Partial<Record<FigureKey, string | number>>

const extractedLine = z.object({
  label: z.string(),
  amount_cents: z.number().int().nullable(),
  component: z.enum(['payg', 'stsl']).nullable().optional(),
})

const extractionBody = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  lines: z
    .object({
      earnings: z.array(extractedLine).default([]),
      tax: z.array(extractedLine).default([]),
    })
    .default({ earnings: [], tax: [] }),
})

const EXTRACTION_MESSAGES = {
  extraction_unavailable:
    'Reading documents is switched off for this household. Provide the payslip figures.',
  extraction_not_payslip:
    'The file does not look like a payslip. Check the file or provide the payslip figures.',
  extraction_unsupported_type:
    'This file type cannot be read automatically. Provide the payslip figures.',
  extraction_failed: 'The document could not be read. Provide the payslip figures.',
} as const

function extractionError(code: keyof typeof EXTRACTION_MESSAGES): ToolError {
  return new ToolError(code, EXTRACTION_MESSAGES[code])
}

/** Maps a non-2xx `payslip-extract` body onto a stable code; the body itself is never relayed. */
function extractionFailureCode(body: unknown): keyof typeof EXTRACTION_MESSAGES {
  const detail = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (detail.code === 'unsupported_type') return 'extraction_unsupported_type'
  if (detail.configured === false || detail.outOfCredit === true || detail.keyRejected === true) {
    return 'extraction_unavailable'
  }
  if (detail.notPayslip === true) return 'extraction_not_payslip'
  return 'extraction_failed'
}

async function extract(ctx: NestContext, path: string, financialYear: number) {
  const { data, error } = await ctx.supabase.functions.invoke<unknown>('payslip-extract', {
    body: { path, financialYear },
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    const body = response instanceof Response ? await response.json().catch(() => null) : null
    throw extractionError(extractionFailureCode(body))
  }
  const parsed = extractionBody.safeParse(data)
  if (!parsed.success) throw extractionError('extraction_failed')
  const fields: FigureValues = {}
  for (const key of FIGURE_KEYS) {
    const value = parsed.data.fields[key]
    if (key.endsWith('_cents')) {
      if (typeof value === 'number' && centsSchema.safeParse(value).success) fields[key] = value
    } else if (typeof value === 'string' && isoDateSchema.safeParse(value).success) {
      fields[key] = value
    }
  }
  return { fields, lines: parsed.data.lines }
}

const REQUIRED: readonly FigureKey[] = [
  'period_start',
  'period_end',
  'gross_cents',
  'tax_withheld_cents',
  'super_cents',
  'net_cents',
]

/**
 * Creates a payslip from its document. The file is stored under a minted id and
 * read through `payslip-extract` for any figure the caller did not give; given
 * values win. Lines read from the document are returned for review, not saved:
 * which inflow an earning draws on is the caller's to say (pass `lines`). A
 * failure after the upload deletes the stored file.
 */
export async function createPayslipFromDocument(
  ctx: NestContext,
  input: z.infer<typeof fromDocumentFields> & DocumentInput,
) {
  const member = await resolveMember(ctx, input.member)
  if (input.lines !== undefined) checkLines(input.lines)
  const { name, bytes } = await readDocument(ctx, input)
  const id = ctx.randomUUID()
  const path = await uploadDocument(ctx, id, name, bytes)
  try {
    const stated: FigureValues = {}
    for (const key of FIGURE_KEYS) {
      if (input[key] !== undefined) stated[key] = input[key]
    }
    let extracted: Awaited<ReturnType<typeof extract>> = {
      fields: {},
      lines: { earnings: [], tax: [] },
    }
    if (REQUIRED.some((key) => stated[key] === undefined)) {
      if (!canExtract(name)) throw extractionError('extraction_unsupported_type')
      const periodEnd = (stated.period_end as string | undefined) ?? ctx.now().toISOString()
      extracted = await extract(
        ctx,
        path,
        payslipFinancialYear(stated.paid_on as string | undefined, periodEnd.slice(0, 10)),
      )
    }
    const merged: FigureValues = { ...extracted.fields, ...stated }
    const missing = REQUIRED.filter((key) => merged[key] === undefined)
    if (missing.length > 0) {
      throw new ToolError(
        'incomplete_details',
        `The document did not show: ${missing.join(', ')}. Provide them and try again.`,
      )
    }
    const num = (key: FigureKey) => (merged[key] as number | undefined) ?? null
    const figs: Figures = {
      member_id: member.id,
      period_start: merged.period_start as string,
      period_end: merged.period_end as string,
      paid_on: (merged.paid_on as string | undefined) ?? null,
      gross_cents: merged.gross_cents as number,
      tax_withheld_cents: merged.tax_withheld_cents as number,
      super_cents: merged.super_cents as number,
      net_cents: merged.net_cents as number,
      salary_sacrifice_cents: num('salary_sacrifice_cents'),
      ytd_gross_cents: num('ytd_gross_cents'),
      ytd_tax_withheld_cents: num('ytd_tax_withheld_cents'),
      ytd_super_cents: num('ytd_super_cents'),
      note: input.note ?? null,
    }
    await save(ctx, id, figs, path, (input.lines ?? []).map(toRpcLine))
    const fromDocument = FIGURE_KEYS.filter(
      (key) => stated[key] === undefined && merged[key] !== undefined,
    )
    const readLines = extracted.lines.earnings.length + extracted.lines.tax.length > 0
    return {
      id,
      member: member.name,
      financial_year: payslipFinancialYear(figs.paid_on, figs.period_end),
      ...figs,
      has_document: true,
      fields_read_from_document: fromDocument,
      lines_read_from_document: extracted.lines,
      note:
        fromDocument.length > 0 || readLines
          ? 'Values read from the document were extracted by AI; check them against it. Lines read from it are not saved; pass them to update_payslip as lines, naming each earning’s inflow and each tax line’s component.'
          : null,
    }
  } catch (error) {
    await discardUpload(ctx, path)
    throw error
  }
}
