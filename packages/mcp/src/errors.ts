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
  'incomplete_details',
  'invalid_details',
  'derived_line',
  'member_recipient',
  'private_gift',
  'allowance_overdrawn',
  'invalid_account',
  'automatic_group',
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

/** The failure for a rejected write: the allowance guard's refusal by name, anything else a plain save failure. */
export function writeError(error: unknown): ToolError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined
  return fixedError(message === 'allowance_overdrawn' ? 'allowance_overdrawn' : 'save_failed')
}
