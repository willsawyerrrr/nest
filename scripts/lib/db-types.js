// The pure part of `gen-db-types.js`: recovering the generated types from
// `supabase gen types` output. The CLI sometimes appends a telemetry line
// (`{"_tag":"Error",…}`) after the types when its analytics flush times out, and
// exits non-zero into the bargain — so the wrapper ignores the exit code and
// trims everything past the final `} as const`. When the output has no
// `} as const` at all, the schema source was unreachable (or a container never
// started) and there is nothing to recover.

/**
 * The generated types from a `supabase gen types` stdout, trimmed to the final
 * `} as const` (with a trailing newline), or `null` when the output carries no
 * types.
 */
export function stripToGeneratedSchema(stdout) {
  const lines = stdout.split('\n')
  const end = lines.lastIndexOf('} as const')
  if (end === -1) return null
  return lines.slice(0, end + 1).join('\n') + '\n'
}
