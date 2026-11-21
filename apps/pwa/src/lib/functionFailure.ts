/**
 * Reads the stable `code` from the JSON body of a non-2xx edge function
 * response, or null when the body carries none.
 */
export async function functionFailureCode(
  error: Error & { context?: unknown },
): Promise<string | null> {
  if (!(error.context instanceof Response)) {
    return null
  }
  try {
    const body = (await error.context.json()) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}
