/**
 * Serialises an engine result to JSON. `JSON.stringify` throws on a `bigint`,
 * so each one is written as a decimal string: exact at any magnitude, and the
 * receiver decodes it as an integer rather than a lossy double.
 */
export function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  )
}
