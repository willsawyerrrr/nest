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
  'upload_failed',
  'extraction_unavailable',
  'extraction_not_receipt',
  'extraction_unsupported_type',
  'extraction_failed',
  'incomplete_details',
  'query_failed',
  'save_failed',
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
  file_too_large: 'That file is too large. The limit is 25 MB.',
  upload_failed: 'The file could not be stored.',
  query_failed: 'The data could not be read.',
  save_failed: 'The record could not be saved.',
} as const satisfies Partial<Record<ErrorCode, string>>

/** A failure with the fixed copy for `code`. */
export function fixedError(code: keyof typeof FIXED_MESSAGES): ToolError {
  return new ToolError(code, FIXED_MESSAGES[code])
}
