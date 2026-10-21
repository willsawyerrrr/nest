import { expect } from 'vitest'
import { ToolError } from '../errors.ts'

/** The `ToolError` a tool call rejects with. */
export async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}
