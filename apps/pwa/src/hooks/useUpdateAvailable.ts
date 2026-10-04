import { useChangelog } from './useChangelog'

/**
 * Whether a newer version of the app carrying a new feature (a `feat` change) is
 * ready to reload into. Other change types and in-progress work do not count; a
 * changelog that is loading, failed, or empty has no update.
 */
export function useUpdateAvailable(): boolean {
  return useChangelog().available.some(({ type }) => type === 'feat')
}
