import { NumberInput, type NumberInputProps } from '@mantine/core'

/**
 * Mantine `NumberInput` preset for entering AU dollar amounts: a `$` prefix, a
 * comma thousands separator, and two fixed decimal places. `allowedDecimalSeparators`
 * is pinned to the dot alone so a pasted or typed comma is read as a thousands
 * separator rather than a decimal point — without it, `1,511.41` would parse as
 * `1.51`. Every default is overridable, and all other `NumberInput` props (label,
 * value, onChange, min, hideControls, and so on) pass straight through.
 */
export function MoneyInput(props: NumberInputProps) {
  return (
    <NumberInput
      prefix="$"
      thousandSeparator=","
      decimalSeparator="."
      allowedDecimalSeparators={['.']}
      decimalScale={2}
      fixedDecimalScale
      {...props}
    />
  )
}
