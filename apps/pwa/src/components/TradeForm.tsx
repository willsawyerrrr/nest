import { useState } from 'react'
import { Group, NumberInput, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import { todayIso } from '../lib/dates'
import type { TradeSide } from '../lib/domain'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { TRADE_SIDES } from '../lib/trades'
import { EnumSegmentedControl } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface TradeFormProps {
  member: { id: string; name: string }
  initial?: TradeRow | undefined
  onSubmit: (input: TradeInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single trade. Persistence lives in the caller. */
export function TradeForm({ member, initial, onSubmit, onCancel }: TradeFormProps) {
  const [side, setSide] = useState<TradeSide>(initial?.side ?? 'buy')
  const [ticker, setTicker] = useState(initial?.ticker ?? '')
  const [tradedOn, setTradedOn] = useState<string | null>(initial?.traded_on ?? todayIso())
  const [units, setUnits] = useState<number | string>(initial ? Number(initial.units) : '')
  const [price, setPrice] = useState<number | string>(centsToDollars(initial?.price_per_unit_cents))
  const [fee, setFee] = useState<number | string>(centsToDollars(initial?.fee_cents))

  const unitsValue = typeof units === 'number' ? units : Number.parseFloat(units)
  const priceCents = dollarsToCents(price)
  const canSubmit =
    ticker.trim() !== '' &&
    tradedOn !== null &&
    Number.isFinite(unitsValue) &&
    unitsValue > 0 &&
    priceCents !== null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this trade. Please try again.',
    onSubmit,
    buildInput: (): TradeInput => ({
      member_id: member.id,
      ticker: ticker.trim().toUpperCase(),
      side,
      traded_on: tradedOn!,
      units: unitsValue,
      price_per_unit_cents: priceCents!,
      fee_cents: dollarsToCents(fee) ?? 0,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="trade"
      onCancel={onCancel}
    >
      <EnumSegmentedControl
        fullWidth
        size="sm"
        aria-label="Trade side"
        value={side}
        onChange={setSide}
        data={TRADE_SIDES}
      />

      <Group grow align="flex-start">
        <TextInput
          label="Ticker"
          size="sm"
          placeholder="e.g. VAS"
          value={ticker}
          onChange={(event) => setTicker(event.currentTarget.value)}
        />
        <DateInput
          label="Date"
          size="sm"
          valueFormat="D MMM YYYY"
          value={tradedOn}
          onChange={setTradedOn}
        />
      </Group>

      <NumberInput
        label="Units"
        size="sm"
        description="Up to six decimal places."
        min={0}
        decimalScale={6}
        hideControls
        value={units}
        onChange={setUnits}
      />

      <Group grow align="flex-start">
        <MoneyInput
          label="Price per unit"
          size="sm"
          min={0}
          hideControls
          value={price}
          onChange={setPrice}
        />
        <MoneyInput
          label="Brokerage fee"
          size="sm"
          min={0}
          hideControls
          value={fee}
          onChange={setFee}
        />
      </Group>
    </FormShell>
  )
}
