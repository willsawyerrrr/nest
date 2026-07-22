import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { EquityInstrumentType, VestingFrequency } from '@nest/plan'
import type { EquityGrantInput, EquityGrantRow } from '../hooks/useEquityGrants'
import { EQUITY_INSTRUMENT_TYPES, VESTING_FREQUENCIES } from '../lib/equity'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSegmentedControl, EnumSelect } from './EnumSelect'

interface EquityGrantFormProps {
  member: { id: string; name: string }
  initial?: EquityGrantRow
  onSubmit: (input: EquityGrantInput) => void | Promise<void>
  onCancel?: () => void
}

/** Today as an ISO date (`YYYY-MM-DD`), the default grant date for a new grant. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** An integer field's value as a number, or a fallback when blank or invalid. */
function intOr(value: number | string, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Presentational add/edit form for a single equity grant. Persistence lives in the caller. */
export function EquityGrantForm({ member, initial, onSubmit, onCancel }: EquityGrantFormProps) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [instrumentType, setInstrumentType] = useState<EquityInstrumentType>(
    (initial?.instrument_type as EquityInstrumentType) ?? 'option',
  )
  const [quantity, setQuantity] = useState<number | string>(initial?.quantity ?? '')
  const [grantDate, setGrantDate] = useState<string | null>(initial?.grant_date ?? todayIso())
  const [cliffMonths, setCliffMonths] = useState<number | string>(initial?.cliff_months ?? 12)
  const [vestingPeriodMonths, setVestingPeriodMonths] = useState<number | string>(
    initial?.vesting_period_months ?? 48,
  )
  const [vestingFrequency, setVestingFrequency] = useState<VestingFrequency>(
    (initial?.vesting_frequency as VestingFrequency) ?? 'monthly',
  )
  const [strikePrice, setStrikePrice] = useState<number | string>(
    centsToDollars(initial?.strike_price_cents),
  )
  const [pricePerShare, setPricePerShare] = useState<number | string>(
    centsToDollars(initial?.price_per_share_cents),
  )
  const [priceAsOf, setPriceAsOf] = useState<string | null>(initial?.price_as_of ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOption = instrumentType === 'option'
  const canSubmit =
    label.trim() !== '' &&
    quantity !== '' &&
    grantDate !== null &&
    intOr(vestingPeriodMonths, 0) > 0 &&
    !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || grantDate === null) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: EquityGrantInput = {
      member_id: member.id,
      label: label.trim(),
      instrument_type: instrumentType,
      quantity: intOr(quantity, 0),
      grant_date: grantDate,
      cliff_months: intOr(cliffMonths, 0),
      vesting_period_months: intOr(vestingPeriodMonths, 1),
      vesting_frequency: vestingFrequency,
      strike_price_cents: isOption ? dollarsToCents(strikePrice) : null,
      price_per_share_cents: dollarsToCents(pricePerShare) ?? 0,
      price_as_of: priceAsOf,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this grant. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <TextInput
          label="Label"
          size="sm"
          placeholder="e.g. 2024 option grant"
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />

        <EnumSegmentedControl
          fullWidth
          size="sm"
          aria-label="Instrument type"
          value={instrumentType}
          onChange={setInstrumentType}
          data={EQUITY_INSTRUMENT_TYPES}
        />

        <NumberInput
          label="Quantity"
          size="sm"
          description="Whole options or shares granted."
          min={0}
          step={1}
          allowDecimal={false}
          hideControls
          value={quantity}
          onChange={setQuantity}
        />

        <DateInput
          label="Grant date"
          size="sm"
          valueFormat="D MMM YYYY"
          value={grantDate}
          onChange={setGrantDate}
        />

        <Group grow>
          <NumberInput
            label="Cliff (months)"
            size="sm"
            min={0}
            step={1}
            allowDecimal={false}
            hideControls
            value={cliffMonths}
            onChange={setCliffMonths}
          />
          <NumberInput
            label="Vesting period (months)"
            size="sm"
            min={1}
            step={1}
            allowDecimal={false}
            hideControls
            value={vestingPeriodMonths}
            onChange={setVestingPeriodMonths}
          />
        </Group>

        <EnumSelect
          label="Vesting frequency"
          size="sm"
          data={VESTING_FREQUENCIES}
          value={vestingFrequency}
          onChange={(value) => value && setVestingFrequency(value)}
          allowDeselect={false}
        />

        {isOption && (
          <NumberInput
            label="Strike price"
            size="sm"
            description="Per-share exercise price."
            prefix="$"
            thousandSeparator
            decimalScale={2}
            fixedDecimalScale
            min={0}
            hideControls
            value={strikePrice}
            onChange={setStrikePrice}
          />
        )}

        <NumberInput
          label="Price per share"
          size="sm"
          description="Current fair value per share (409A-equivalent), maintained by you."
          prefix="$"
          thousandSeparator
          decimalScale={2}
          fixedDecimalScale
          min={0}
          hideControls
          value={pricePerShare}
          onChange={setPricePerShare}
        />

        <DateInput
          label="Price as of"
          size="sm"
          description="When the price per share was last confirmed."
          valueFormat="D MMM YYYY"
          clearable
          value={priceAsOf}
          onChange={setPriceAsOf}
        />

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add grant'}
          </Button>
          {onCancel && (
            <Button type="button" variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  )
}
