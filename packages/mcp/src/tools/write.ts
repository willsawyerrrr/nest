import { basename } from 'node:path'
import { z } from 'zod'
import { financialYearForDate } from '@nest/tax'
import { resolveMember, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import { canExtract, MAX_UPLOAD_BYTES, storageKeyName, storedContentType } from '../upload.ts'

const RECEIPTS_BUCKET = 'receipts'

export const DEDUCTION_CATEGORIES = ['work_expense', 'donation', 'tax_agent_fees'] as const
export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number]

/** Whole cents, never a float. */
export const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** An ISO calendar date that exists. */
export const isoDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}, 'Expected a date as YYYY-MM-DD')

export const addWishlistItemInput = z.object({
  name: z.string().trim().min(1),
  amount_cents: centsSchema.positive(),
  member: z.string().trim().min(1).optional(),
  note: z.string().trim().min(1).optional(),
})

/**
 * Adds an item to the household's wishlist. `member` (a name) tags whose wish it
 * is; the tag is a display label only.
 */
export async function addWishlistItem(
  ctx: NestContext,
  input: z.infer<typeof addWishlistItemInput>,
) {
  const member = input.member === undefined ? null : await resolveMember(ctx, input.member)
  const { data, error } = await ctx.supabase
    .from('wishlist_item')
    .insert({
      household_id: ctx.householdId,
      name: input.name,
      amount_cents: input.amount_cents,
      member_id: member?.id ?? null,
      note: input.note ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw fixedError('save_failed')
  }
  return {
    id: (data as { id: string }).id,
    name: input.name,
    amount_cents: input.amount_cents,
    member: member?.name ?? null,
    note: input.note ?? null,
  }
}

export const createDeductionInput = z.object({
  file_path: z.string().trim().min(1),
  category: z.enum(DEDUCTION_CATEGORIES).default('work_expense'),
  member: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  amount_cents: centsSchema.optional(),
  deduction_date: isoDateSchema.optional(),
  financial_year: z.number().int().min(2000).max(2100).optional(),
})

const extractionBody = z.object({
  model: z.string(),
  fields: z
    .object({
      description: z.string().optional(),
      deduction_date: isoDateSchema.optional(),
      amount_cents: centsSchema.optional(),
    })
    .partial()
    .default({}),
})

type ExtractedFields = z.infer<typeof extractionBody>['fields']

const EXTRACTION_MESSAGES = {
  extraction_unavailable:
    'Reading documents is switched off for this household. Provide description, amount_cents and deduction_date.',
  extraction_not_receipt:
    'The file does not look like the document this category expects. Check the file or the category, or provide description, amount_cents and deduction_date.',
  extraction_unsupported_type:
    'This file type cannot be read automatically. Provide description, amount_cents and deduction_date.',
  extraction_failed:
    'The document could not be read. Provide description, amount_cents and deduction_date.',
} as const

type ExtractionFailureCode = keyof typeof EXTRACTION_MESSAGES

function extractionError(code: ExtractionFailureCode): ToolError {
  return new ToolError(code, EXTRACTION_MESSAGES[code])
}

/** Maps a non-2xx `deduction-extract` body onto a stable code; the body itself is never relayed. */
function extractionFailureCode(body: unknown): ExtractionFailureCode {
  const detail = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (detail.code === 'unsupported_type') return 'extraction_unsupported_type'
  if (detail.configured === false || detail.outOfCredit === true || detail.keyRejected === true) {
    return 'extraction_unavailable'
  }
  if (detail.notReceipt === true) return 'extraction_not_receipt'
  return 'extraction_failed'
}

async function extractFields(
  ctx: NestContext,
  path: string,
  category: DeductionCategory,
  financialYear: number,
): Promise<ExtractedFields> {
  const { data, error } = await ctx.supabase.functions.invoke<unknown>('deduction-extract', {
    body: { path, category, financialYear },
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    const body = response instanceof Response ? await response.json().catch(() => null) : null
    throw extractionError(extractionFailureCode(body))
  }
  const parsed = extractionBody.safeParse(data)
  if (!parsed.success) {
    throw extractionError('extraction_failed')
  }
  return parsed.data.fields
}

/** Deletes an uploaded object no deduction references. Best effort, never surfaced. */
async function discardUpload(ctx: NestContext, path: string): Promise<void> {
  try {
    await ctx.supabase.storage.from(RECEIPTS_BUCKET).remove([path])
  } catch {
    // The object is unreferenced either way.
  }
}

/**
 * Creates a deduction from a local document. The file is uploaded to the
 * `receipts` bucket under `<household_id>/<deduction_id>/…` with a client-minted
 * id, read through `deduction-extract` to fill the details the caller did not
 * state, and written with its receipt in one transaction by
 * `create_deduction_with_receipt`. Caller-supplied values always win over
 * extracted ones. A failure after the upload deletes the stored file.
 */
export async function createDeductionFromDocument(
  ctx: NestContext,
  input: z.infer<typeof createDeductionInput>,
) {
  const member = await resolveMember(ctx, input.member)

  let bytes: Uint8Array
  try {
    bytes = await ctx.readFile(input.file_path)
  } catch {
    throw fixedError('file_unreadable')
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw fixedError('file_too_large')
  }

  const fileName = basename(input.file_path)
  const deductionId = ctx.randomUUID()
  const objectPath = `${ctx.householdId}/${deductionId}/${ctx.randomUUID()}-${storageKeyName(fileName)}`
  const { error: uploadError } = await ctx.supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(objectPath, bytes, { contentType: storedContentType(fileName) })
  if (uploadError) {
    throw fixedError('upload_failed')
  }

  try {
    const stated = {
      description: input.description,
      amount_cents: input.amount_cents,
      deduction_date: input.deduction_date,
    }
    const complete = Object.values(stated).every((value) => value !== undefined)

    let extracted: ExtractedFields = {}
    if (!complete) {
      if (!canExtract(fileName)) {
        throw extractionError('extraction_unsupported_type')
      }
      const hintYear =
        input.deduction_date !== undefined
          ? financialYearForDate(new Date(`${input.deduction_date}T00:00:00Z`))
          : (input.financial_year ?? financialYearForDate(ctx.now()))
      extracted = await extractFields(ctx, objectPath, input.category, hintYear)
    }

    const description = stated.description ?? extracted.description
    const amountCents = stated.amount_cents ?? extracted.amount_cents
    const deductionDate = stated.deduction_date ?? extracted.deduction_date
    const missing = [
      description === undefined && 'description',
      amountCents === undefined && 'amount_cents',
      deductionDate === undefined && 'deduction_date',
    ].filter((name): name is string => name !== false)
    if (description === undefined || amountCents === undefined || deductionDate === undefined) {
      throw new ToolError(
        'incomplete_details',
        `The document did not show: ${missing.join(', ')}. Provide them and try again.`,
      )
    }

    const financialYear = financialYearForDate(new Date(`${deductionDate}T00:00:00Z`))
    const { error } = await ctx.supabase.rpc('create_deduction_with_receipt', {
      p_deduction: {
        id: deductionId,
        household_id: ctx.householdId,
        member_id: member.id,
        description,
        amount_cents: amountCents,
        deduction_date: deductionDate,
        financial_year: financialYear,
        category: input.category,
      },
      p_receipt_path: objectPath,
    })
    if (error) {
      throw fixedError('save_failed')
    }

    const fromDocument = (Object.keys(stated) as (keyof typeof stated)[]).filter(
      (key) => stated[key] === undefined,
    )
    return {
      id: deductionId,
      member: member.name,
      category: input.category,
      description,
      amount_cents: amountCents,
      deduction_date: deductionDate,
      financial_year: financialYear,
      fields_read_from_document: fromDocument,
      note:
        fromDocument.length > 0
          ? 'Fields read from the document were extracted by AI; check them against it.'
          : null,
    }
  } catch (error) {
    await discardUpload(ctx, objectPath)
    throw error
  }
}
