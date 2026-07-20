/**
 * A leading emoji: one Extended_Pictographic base, optionally followed by a VS16
 * presentation selector, ZWJ-joined pictographs, or a skin-tone modifier.
 */
const LEADING_EMOJI =
  /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/u

/**
 * Splits an account/saver name into its leading emoji (the Up account icon) and
 * the remaining label. A name that is only an emoji, or has none, yields a null
 * emoji and the whole trimmed name as the label.
 */
export function splitLeadingEmoji(name: string): { emoji: string | null; label: string } {
  const trimmed = name.trim()
  const match = trimmed.match(LEADING_EMOJI)
  if (!match) {
    return { emoji: null, label: trimmed }
  }
  const emoji = match[0]
  const label = trimmed.slice(emoji.length).trim()
  if (label === '') {
    return { emoji: null, label: trimmed }
  }
  return { emoji, label }
}

/** An account/saver name with any leading emoji stripped. */
export function accountLabel(name: string): string {
  return splitLeadingEmoji(name).label
}
