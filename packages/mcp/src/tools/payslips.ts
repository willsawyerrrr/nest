import { z } from 'zod'
import { financialYearForDate } from '@nest/tax'
import { resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import { centsSchema, isoDateSchema } from './write.ts'

export const PAYSLIPS_BUCKET = 'payslips'

/** A signed whole number of cents; a line may be a negative adjustment. */
const signedCentsSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)

export const lineSchema = z.object({
  kind: z.enum(['earning', 'tax']),
  label: z.string().trim().min(1),
  amount_cents: signedCentsSchema,
  source_inflow_id: z.uuid().optional(),
  tax_component: z.enum(['payg', 'stsl']).optional(),
})

type LineInput = z.infer<typeof lineSchema>

interface RpcLine {
  kind: 'earning' | 'tax'
  label: string
  amount_cents: number
  source_inflow_id: string | null
  tax_component: 'payg' | 'stsl' | null
}

export const linesSchema = z
  .array(lineSchema)
  .describe(
    "The slip's whole set of lines, replacing any existing ones: an earning (optionally source_inflow_id, the taxable inflow it draws on) or a tax line (tax_component payg or stsl, no inflow).",
  )

export const dateField = isoDateSchema
export const noteField = z.string().trim().min(1)

export const listPayslipsInput = z.object({
  financial_year: z.number().int().min(2000).max(2100).optional(),
  member: z.string().trim().min(1).optional(),
})

export const amounts = {
  gross_cents: centsSchema,
  tax_withheld_cents: centsSchema,
  super_cents: centsSchema,
  net_cents: centsSchema,
}

export const optionalAmounts = {
  salary_sacrifice_cents: centsSchema,
  ytd_gross_cents: centsSchema,
  ytd_tax_withheld_cents: centsSchema,
  ytd_super_cents: centsSchema,
}

export const createPayslipInput = z.object({
  member: z.string().trim().min(1).optional(),
  period_start: dateField,
  period_end: dateField,
  paid_on: dateField.optional(),
  ...amounts,
  salary_sacrifice_cents: optionalAmounts.salary_sacrifice_cents.optional(),
  ytd_gross_cents: optionalAmounts.ytd_gross_cents.optional(),
  ytd_tax_withheld_cents: optionalAmounts.ytd_tax_withheld_cents.optional(),
  ytd_super_cents: optionalAmounts.ytd_super_cents.optional(),
  note: noteField.optional(),
  lines: linesSchema.optional(),
})

export const updatePayslipInput = z.object({
  id: z.uuid(),
  member: z.string().trim().min(1).optional(),
  period_start: dateField.optional(),
  period_end: dateField.optional(),
  paid_on: dateField.nullable().optional(),
  gross_cents: amounts.gross_cents.optional(),
  tax_withheld_cents: amounts.tax_withheld_cents.optional(),
  super_cents: amounts.super_cents.optional(),
  net_cents: amounts.net_cents.optional(),
  salary_sacrifice_cents: optionalAmounts.salary_sacrifice_cents.nullable().optional(),
  ytd_gross_cents: optionalAmounts.ytd_gross_cents.nullable().optional(),
  ytd_tax_withheld_cents: optionalAmounts.ytd_tax_withheld_cents.nullable().optional(),
  ytd_super_cents: optionalAmounts.ytd_super_cents.nullable().optional(),
  note: noteField.nullable().optional(),
  lines: linesSchema.optional(),
})

export const deletePayslipInput = z.object({ id: z.uuid() })
export interface Figures {
  member_id: string
  period_start: string
  period_end: string
  paid_on: string | null
  gross_cents: number
  tax_withheld_cents: number
  super_cents: number
  net_cents: number
  salary_sacrifice_cents: number | null
  ytd_gross_cents: number | null
  ytd_tax_withheld_cents: number | null
  ytd_super_cents: number | null
  note: string | null
}

interface PayslipRow extends Figures {
  id: string
  financial_year: number
  file_path: string | null
}

interface LineRow extends RpcLine {
  payslip_id: string
  attracts_super: boolean | null
}

/** The AU financial year a slip is filed under: the year its pay landed in, else its period's last day. */
export function payslipFinancialYear(paidOn: string | null | undefined, periodEnd: string): number {
  return financialYearForDate(new Date(`${paidOn ?? periodEnd}T00:00:00Z`))
}

export function checkLines(lines: readonly LineInput[]): void {
  for (const line of lines) {
    const bad =
      line.kind === 'earning'
        ? line.tax_component !== undefined
        : line.source_inflow_id !== undefined || line.tax_component === undefined
    if (bad) {
      throw new ToolError(
        'invalid_details',
        'An earning line names an inflow and no tax component; a tax line names a tax component and no inflow.',
      )
    }
  }
}

export function toRpcLine(line: LineInput): RpcLine {
  return {
    kind: line.kind,
    label: line.label,
    amount_cents: line.amount_cents,
    source_inflow_id: line.source_inflow_id ?? null,
    tax_component: line.tax_component ?? null,
  }
}

function rowToRpcLine(line: LineRow): RpcLine {
  return {
    kind: line.kind,
    label: line.label,
    amount_cents: line.amount_cents,
    source_inflow_id: line.source_inflow_id,
    tax_component: line.tax_component,
  }
}

/** Writes the slip and replaces its lines in one transaction. A null `filePath` keeps any stored document. */
export async function save(
  ctx: NestContext,
  id: string,
  figs: Figures,
  filePath: string | null,
  lines: readonly RpcLine[],
): Promise<void> {
  if (figs.period_end < figs.period_start) {
    throw new ToolError('invalid_details', 'period_end cannot be before period_start.')
  }
  const { error } = await ctx.supabase.rpc('upsert_payslip_with_lines', {
    p_payslip: {
      ...figs,
      id,
      household_id: ctx.householdId,
      financial_year: payslipFinancialYear(figs.paid_on, figs.period_end),
      file_path: filePath,
    },
    p_lines: lines,
  })
  if (error) throw fixedError('save_failed')
}

export async function discardUpload(ctx: NestContext, path: string | null): Promise<void> {
  if (path === null) return
  try {
    await ctx.supabase.storage.from(PAYSLIPS_BUCKET).remove([path])
  } catch {
    // The object is unreferenced either way.
  }
}

function view(row: PayslipRow, lines: LineRow[], members: Map<string, string>) {
  return {
    id: row.id,
    member: members.get(row.member_id) ?? null,
    financial_year: row.financial_year,
    period_start: row.period_start,
    period_end: row.period_end,
    paid_on: row.paid_on,
    gross_cents: row.gross_cents,
    tax_withheld_cents: row.tax_withheld_cents,
    super_cents: row.super_cents,
    net_cents: row.net_cents,
    salary_sacrifice_cents: row.salary_sacrifice_cents,
    ytd_gross_cents: row.ytd_gross_cents,
    ytd_tax_withheld_cents: row.ytd_tax_withheld_cents,
    ytd_super_cents: row.ytd_super_cents,
    has_document: row.file_path !== null,
    note: row.note,
    lines: lines
      .filter((line) => line.payslip_id === row.id)
      .map((line) => ({ ...rowToRpcLine(line), attracts_super: line.attracts_super })),
  }
}

export async function loadPayslip(ctx: NestContext, id: string): Promise<PayslipRow> {
  const { data, error } = await ctx.supabase.from('payslip').select('*').eq('id', id).maybeSingle()
  if (error) throw fixedError('query_failed')
  if (!data) throw new ToolError('not_found', 'No payslip matches that id.')
  return data as PayslipRow
}

export function figuresOf(row: PayslipRow): Figures {
  return {
    member_id: row.member_id,
    period_start: row.period_start,
    period_end: row.period_end,
    paid_on: row.paid_on,
    gross_cents: row.gross_cents,
    tax_withheld_cents: row.tax_withheld_cents,
    super_cents: row.super_cents,
    net_cents: row.net_cents,
    salary_sacrifice_cents: row.salary_sacrifice_cents,
    ytd_gross_cents: row.ytd_gross_cents,
    ytd_tax_withheld_cents: row.ytd_tax_withheld_cents,
    ytd_super_cents: row.ytd_super_cents,
    note: row.note,
  }
}

export async function loadLines(ctx: NestContext, id: string): Promise<RpcLine[]> {
  return (await selectAll<LineRow>(ctx, 'payslip_line', { payslip_id: id })).map(rowToRpcLine)
}

/** Lists payslips, each with its lines, most recent pay period first. */
export async function listPayslips(ctx: NestContext, input: z.infer<typeof listPayslipsInput>) {
  const filters: Record<string, string | number> = {}
  if (input.financial_year !== undefined) filters.financial_year = input.financial_year
  if (input.member !== undefined) filters.member_id = (await resolveMember(ctx, input.member)).id
  const [rows, lines, memberRows] = await Promise.all([
    selectAll<PayslipRow>(ctx, 'payslip', filters),
    selectAll<LineRow>(ctx, 'payslip_line'),
    selectAll<{ id: string; name: string }>(ctx, 'members'),
  ])
  const members = new Map(memberRows.map((row) => [row.id, row.name]))
  return {
    payslips: rows
      .toSorted((a, b) => b.period_end.localeCompare(a.period_end))
      .map((row) => view(row, lines, members)),
  }
}

/** Creates a payslip and its lines. The financial year is derived from `paid_on`, else `period_end`. */
export async function createPayslip(ctx: NestContext, input: z.infer<typeof createPayslipInput>) {
  const member = await resolveMember(ctx, input.member)
  const lines = input.lines ?? []
  checkLines(lines)
  const id = ctx.randomUUID()
  const figs: Figures = {
    member_id: member.id,
    period_start: input.period_start,
    period_end: input.period_end,
    paid_on: input.paid_on ?? null,
    gross_cents: input.gross_cents,
    tax_withheld_cents: input.tax_withheld_cents,
    super_cents: input.super_cents,
    net_cents: input.net_cents,
    salary_sacrifice_cents: input.salary_sacrifice_cents ?? null,
    ytd_gross_cents: input.ytd_gross_cents ?? null,
    ytd_tax_withheld_cents: input.ytd_tax_withheld_cents ?? null,
    ytd_super_cents: input.ytd_super_cents ?? null,
    note: input.note ?? null,
  }
  await save(ctx, id, figs, null, lines.map(toRpcLine))
  return {
    id,
    member: member.name,
    financial_year: payslipFinancialYear(figs.paid_on, figs.period_end),
    ...figs,
  }
}

/**
 * Edits a payslip, changing only the fields given. Lines given replace the
 * slip's whole set; omitted, they stay. The stored document is kept.
 */
export async function updatePayslip(ctx: NestContext, input: z.infer<typeof updatePayslipInput>) {
  const row = await loadPayslip(ctx, input.id)
  const member = input.member === undefined ? null : await resolveMember(ctx, input.member)
  const current = figuresOf(row)
  const figs: Figures = {
    member_id: member?.id ?? current.member_id,
    period_start: input.period_start ?? current.period_start,
    period_end: input.period_end ?? current.period_end,
    paid_on: input.paid_on === undefined ? current.paid_on : input.paid_on,
    gross_cents: input.gross_cents ?? current.gross_cents,
    tax_withheld_cents: input.tax_withheld_cents ?? current.tax_withheld_cents,
    super_cents: input.super_cents ?? current.super_cents,
    net_cents: input.net_cents ?? current.net_cents,
    salary_sacrifice_cents:
      input.salary_sacrifice_cents === undefined
        ? current.salary_sacrifice_cents
        : input.salary_sacrifice_cents,
    ytd_gross_cents:
      input.ytd_gross_cents === undefined ? current.ytd_gross_cents : input.ytd_gross_cents,
    ytd_tax_withheld_cents:
      input.ytd_tax_withheld_cents === undefined
        ? current.ytd_tax_withheld_cents
        : input.ytd_tax_withheld_cents,
    ytd_super_cents:
      input.ytd_super_cents === undefined ? current.ytd_super_cents : input.ytd_super_cents,
    note: input.note === undefined ? current.note : input.note,
  }
  if (input.lines !== undefined) checkLines(input.lines)
  const lines = input.lines ? input.lines.map(toRpcLine) : await loadLines(ctx, input.id)
  await save(ctx, input.id, figs, null, lines)
  return {
    id: input.id,
    financial_year: payslipFinancialYear(figs.paid_on, figs.period_end),
    ...figs,
  }
}

/** Deletes a payslip, its lines, and its stored document (best effort). */
export async function deletePayslip(ctx: NestContext, input: z.infer<typeof deletePayslipInput>) {
  const row = await loadPayslip(ctx, input.id)
  const { error } = await ctx.supabase
    .from('payslip')
    .delete()
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
  if (error) throw fixedError('save_failed')
  await discardUpload(ctx, row.file_path)
  return { id: input.id, deleted: true }
}
