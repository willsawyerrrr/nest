import { useLocalStorage } from '@mantine/hooks'
import type { SortDirection, SortPreference } from '../lib/sort'

/** A list's sort preference plus the controls to change it. */
export interface UseSortPreferenceResult<K extends string> {
  key: K
  direction: SortDirection
  /** Sets the key to sort by, keeping the current direction. */
  setKey: (key: K) => void
  /** Flips the direction between ascending and descending. */
  toggleDirection: () => void
}

/**
 * A localStorage-backed sort preference for a list: the stored key and
 * direction, a setter for the key, and a toggle for the direction. Persisted
 * under `storageKey` and seeded from `defaultValue`, parameterised by the
 * list's own key type so each list keeps its own key set.
 */
export function useSortPreference<K extends string>(
  storageKey: string,
  defaultValue: SortPreference<K>,
): UseSortPreferenceResult<K> {
  const [preference, setPreference] = useLocalStorage<SortPreference<K>>({
    key: storageKey,
    defaultValue,
    getInitialValueInEffect: false,
  })
  return {
    key: preference.key,
    direction: preference.direction,
    setKey: (key) => setPreference((current) => ({ ...current, key })),
    toggleDirection: () =>
      setPreference((current) => ({
        ...current,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      })),
  }
}
