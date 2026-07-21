/** Which way a sorted order runs. */
export type SortDirection = 'asc' | 'desc'

/** A persisted choice of sort key and direction, keyed to a list's own keys. */
export interface SortPreference<K extends string> {
  key: K
  direction: SortDirection
}

/**
 * Orders items by a comparator, sorting a copy so the caller's array is
 * untouched. The comparator defines the ascending order; `desc` reverses it.
 */
export function sortBy<T>(
  items: T[],
  comparator: (a: T, b: T) => number,
  direction: SortDirection,
): T[] {
  const sorted = [...items].sort(comparator)
  return direction === 'desc' ? sorted.reverse() : sorted
}
