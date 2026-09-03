import { Text, type TextProps } from '@mantine/core'
import { formatIsoDate } from '../lib/dates'
import { formatCents, signMoneyColor } from '../lib/money'
import { MoneyText } from './MoneyText'
import { usePlanningMode } from './PlanningModeProvider'

/** The U+2192 arrow separating the real figure from the proposed one. */
const ARROW = ' → '

/** A signed cents delta as `(+$12.34)` / `(−$12.34)`, U+2212 for the minus. */
function formatDelta(deltaCents: number): string {
  const sign = deltaCents > 0 ? '+' : '−'
  return `(${sign}${formatCents(Math.abs(deltaCents))})`
}

interface ComparedAmountProps extends Omit<TextProps, 'children'> {
  /** The real figure, in integer cents. */
  baselineCents: number
  /** The figure the planning sandbox proposes, in integer cents. */
  proposedCents: number
  /** Tint the plain figure by sign (passed through to {@link MoneyText}). */
  colored?: boolean
}

/**
 * A money figure that, while planning mode is active and the sandbox has moved
 * it, reads `$real → $proposed (±$delta)` with the delta tinted by the
 * app's money-sign semantics — an increase green, a decrease red. Off planning
 * mode, or when the two figures are equal, it is just {@link MoneyText}, so a
 * caller can wire it in unconditionally and it stays invisible until a change
 * actually reaches the figure.
 */
export function ComparedAmount({
  baselineCents,
  proposedCents,
  colored = false,
  ...textProps
}: ComparedAmountProps) {
  const { active } = usePlanningMode()
  if (!active || baselineCents === proposedCents) {
    return <MoneyText cents={proposedCents} colored={colored} {...textProps} />
  }
  const deltaCents = proposedCents - baselineCents
  return (
    <Text component="span" {...textProps}>
      <MoneyText span cents={baselineCents} c="dimmed" td="line-through" />
      <Text component="span" c="dimmed">
        {ARROW}
      </Text>
      <MoneyText span cents={proposedCents} colored={colored} fw={700} />{' '}
      <Text component="span" c={signMoneyColor(deltaCents)}>
        {formatDelta(deltaCents)}
      </Text>
    </Text>
  )
}

/** The whole-day difference between two local ISO dates (`later − earlier`). */
function dayDelta(fromIso: string, toIso: string): number {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
    return new Date(y, m - 1, d).getTime()
  }
  return Math.round((parse(toIso) - parse(fromIso)) / 86_400_000)
}

/**
 * `N days sooner` / `N days later` for a shifted ETA. Only ever called with a
 * non-zero day count — the caller takes the plain path when the two ISO dates
 * are equal.
 */
function formatDayDelta(days: number): string {
  const magnitude = `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
  return days < 0 ? `(${magnitude} sooner)` : `(${magnitude} later)`
}

interface ComparedDateProps extends Omit<TextProps, 'children'> {
  /** The real ETA as a local ISO date, or `null` when there is none. */
  baselineIso: string | null
  /** The ETA the sandbox proposes, or `null` when the change removes it. */
  proposedIso: string | null
  /** The text shown in place of a missing date on either side. */
  noDateLabel?: string
}

/**
 * A date figure — a goal ETA — with the same comparison behaviour as
 * {@link ComparedAmount}: while planning mode is active and the sandbox has
 * moved it, `real → proposed (N days sooner|later)`, an earlier date green
 * and a later one red. Either side may be `null` (no ETA), shown as
 * `noDateLabel`. Off planning mode, or unchanged, it is the plain formatted date
 * (or `noDateLabel`).
 */
export function ComparedDate({
  baselineIso,
  proposedIso,
  noDateLabel = 'no ETA',
  ...textProps
}: ComparedDateProps) {
  const { active } = usePlanningMode()
  const show = (iso: string | null) => (iso === null ? noDateLabel : formatIsoDate(iso))
  if (!active || baselineIso === proposedIso) {
    return (
      <Text component="span" {...textProps}>
        {show(proposedIso)}
      </Text>
    )
  }
  const days =
    baselineIso !== null && proposedIso !== null ? dayDelta(baselineIso, proposedIso) : null
  return (
    <Text component="span" {...textProps}>
      <Text component="span" c="dimmed" td="line-through">
        {show(baselineIso)}
      </Text>
      <Text component="span" c="dimmed">
        {ARROW}
      </Text>
      <Text component="span" fw={700}>
        {show(proposedIso)}
      </Text>{' '}
      {days !== null && (
        <Text component="span" c={signMoneyColor(-days)}>
          {formatDayDelta(days)}
        </Text>
      )}
    </Text>
  )
}
