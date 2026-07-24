import { Text, type TextProps } from '@mantine/core'
import { formatCents, moneyColor } from '../lib/money'

interface MoneyTextProps extends TextProps {
  /** The figure to render, in integer cents. */
  cents: number
  /**
   * Tint the figure by sign using the `positive`/`negative` tokens (`moneyColor`).
   * A zero amount, or `colored={false}`, inherits the surrounding colour and any
   * `c` prop passed through.
   */
  colored?: boolean
}

/**
 * Renders integer cents via `formatCents` with `tabular-nums lining-nums`, so
 * money aligns in columns and reads as figures. This is the app's one money
 * renderer; pass `colored` to signal sign.
 */
export function MoneyText({ cents, colored = false, style, c, ...textProps }: MoneyTextProps) {
  const color = colored ? moneyColor(cents) : c
  return (
    <Text
      {...(color !== undefined && { c: color })}
      style={{ fontVariantNumeric: 'tabular-nums lining-nums', ...style }}
      {...textProps}
    >
      {formatCents(cents)}
    </Text>
  )
}
