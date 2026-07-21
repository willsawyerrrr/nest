import {
  SegmentedControl,
  Select,
  type SegmentedControlProps,
  type SelectProps,
} from '@mantine/core'

/** A Select/SegmentedControl option whose value is a member of the enum `E`. */
interface EnumOption<E extends string> {
  value: E
  label: string
}

export interface EnumSelectProps<E extends string> extends Omit<
  SelectProps<E>,
  'data' | 'onChange'
> {
  data: EnumOption<E>[]
  onChange?: (value: E | null) => void
}

/**
 * Mantine `Select` whose `data` options fix the value type to the enum `E`, so
 * `onChange` yields `E | null` (a Select clears to `null`) rather than the bare
 * `string | null` that would otherwise force an unchecked cast at the call site.
 */
export function EnumSelect<E extends string>(props: EnumSelectProps<E>) {
  return <Select<E> {...props} />
}

export interface EnumSegmentedControlProps<E extends string> extends Omit<
  SegmentedControlProps<E>,
  'data' | 'onChange'
> {
  data: EnumOption<E>[]
  onChange?: (value: E) => void
}

/**
 * Mantine `SegmentedControl` whose `data` options fix the value type to the enum
 * `E`, so `onChange` yields `E` (a SegmentedControl always has a value) rather
 * than the bare `string` that would otherwise force an unchecked cast at the call
 * site.
 */
export function EnumSegmentedControl<E extends string>(props: EnumSegmentedControlProps<E>) {
  return <SegmentedControl<E> {...props} />
}
