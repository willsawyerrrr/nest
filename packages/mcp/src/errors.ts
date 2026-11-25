/**
 * The stable failure vocabulary the tools answer with. Every failure a tool
 * reports carries one of these codes and fixed copy of Nest's own; what a
 * dependency said (a Storage, PostgREST, or edge-function body) is never passed
 * through to the agent.
 */

export const ERROR_CODES = [
  'not_found',
  'file_unreadable',
  'file_too_large',
  'invalid_content',
  'upload_failed',
  'extraction_unavailable',
  'extraction_not_receipt',
  'extraction_unsupported_type',
  'extraction_failed',
  'extraction_not_trade_document',
  'extraction_not_payslip',
  'incomplete_details',
  'invalid_details',
  'derived_line',
  'has_counted_spend',
  'retired_line',
  'default_replacement_required',
  'member_recipient',
  'private_gift',
  'allowance_overdrawn',
  'invalid_account',
  'automatic_group',
  'not_categorisable',
  'invalid_category',
  'up_not_connected',
  'up_auth_failed',
  'up_rejected',
  'up_rate_limited',
  'up_unavailable',
  'query_failed',
  'save_failed',
  'delete_failed',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** A failure a tool reports to the agent as `{ code, message }`. */
export class ToolError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'ToolError'
    this.code = code
  }
}

/** The fixed copy for each code that reads the same in every context. */
export const FIXED_MESSAGES = {
  file_unreadable: 'The file could not be read from the given path.',
  file_too_large: 'That file is too large.',
  invalid_content: 'The content is not valid base64.',
  upload_failed: 'The file could not be stored.',
  query_failed: 'The data could not be read.',
  save_failed: 'The record could not be saved.',
  delete_failed: 'The record could not be deleted.',
  allowance_overdrawn: 'The allowance cannot cover what is drawn from it.',
  invalid_account: 'That account cannot be used here.',
} as const satisfies Partial<Record<ErrorCode, string>>

/** A failure with the fixed copy for `code`. */
export function fixedError(code: keyof typeof FIXED_MESSAGES): ToolError {
  return new ToolError(code, FIXED_MESSAGES[code])
}

/** The refusals the budget-line lifespan guards raise, by the token the database raises them with. */
const LIFESPAN_REFUSALS: Record<string, ToolError> = {
  budget_line_has_spend: new ToolError(
    'has_counted_spend',
    'Spending has counted toward this budget line, so it cannot be deleted; retire it with retire_budget_line instead.',
  ),
  budget_line_retired: new ToolError('retired_line', 'This budget line is already retired.'),
  budget_line_retired_on_immutable: new ToolError(
    'retired_line',
    'A budget line is retired only with retire_budget_line, and never un-retired.',
  ),
  budget_line_retire_before_start: new ToolError(
    'invalid_details',
    'A budget line can only retire or change after the day it starts.',
  ),
  budget_line_default_replacement_required: new ToolError(
    'default_replacement_required',
    'This line is the household default; pass new_default_line_id to name the default from that day.',
  ),
  default_budget_line_invalid: new ToolError(
    'invalid_details',
    'The new default must be a live, started budget line not drawn from an allowance.',
  ),
  budget_line_lifespan: new ToolError(
    'invalid_details',
    'A budget line must start before it retires.',
  ),
}

/**
 * The failure for a rejected write: the allowance guard's and the lifespan
 * guards' refusals by name (raised as the message, or a check constraint named
 * in it), anything else a plain save failure.
 */
export function writeError(error: unknown): ToolError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined
  if (typeof message === 'string') {
    const token = Object.keys(LIFESPAN_REFUSALS).find(
      (key) => message === key || message.includes(`"${key}"`),
    )
    if (token) return LIFESPAN_REFUSALS[token]!
  }
  return fixedError(message === 'allowance_overdrawn' ? 'allowance_overdrawn' : 'save_failed')
}
