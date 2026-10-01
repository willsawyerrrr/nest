import { useState, type ReactNode } from 'react'
import { Alert, Group, NumberInput, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { TradeFormValues, TradeInput, TradeRow } from '../hooks/useTrades'
import { todayIso } from '../lib/dates'
import type { TradeSide } from '../lib/domain'
import {
  centsToDollars,
  dollarsToCents,
  dollarsToMicrodollars,
  microdollarsToDollars,
} from '../lib/money'
import { findDuplicateTrade, TRADE_SIDES } from '../lib/trades'
import { EnumSegmentedControl } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface TradeFormProps {
  member: { id: string; name: string }
  /** A saved trade to edit, or a draft read from a document to confirm. */
  initial?: TradeFormValues | undefined
  /** The household's trades, checked for a likely repeat of what is being entered. */
  trades?: readonly TradeRow[] | undefined
  /** Shown first, above the notice: the document picker and what became of it. */
  attachment?: ReactNode
  /** Whether the attachment is still being stored or read, so a save would send no document. */
  busy?: boolean | undefined
  /**
   * Whether the fields are shown. Hidden, the form is just its attachment and
   * notice, so a card can open on the document prompt alone.
   */
  showFields?: boolean
  /** Shown above the fields, e.g. what a draft's document left for the member to check. */
  notice?: ReactNode
  submitLabel?: string | undefined
  cancelLabel?: string | undefined
  onSubmit: (input: TradeInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single trade. Persistence lives in the caller. */
export function TradeForm({
  member,
  initial,
  trades,
  attachment,
  busy = false,
  showFields = true,
  notice,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}: TradeFormProps) {
  const [side, setSide] = useState<TradeSide>(initial?.side ?? 'buy')
  const [ticker, setTicker] = useState(initial?.ticker ?? '')
  const [tradedOn, setTradedOn] = useState<string | null>(initial?.traded_on ?? todayIso())
  const [units, setUnits] = useState<number | string>(
    initial?.units === undefined ? '' : Number(initial.units),
  )
  const [price, setPrice] = useState<number | string>(
    microdollarsToDollars(initial?.price_per_unit_microdollars),
  )
  const [fee, setFee] = useState<number | string>(centsToDollars(initial?.fee_cents))

  const unitsValue = typeof units === 'number' ? units : Number.parseFloat(units)
  const priceMicrodollars = dollarsToMicrodollars(price)
  const canSubmit =
    ticker.trim() !== '' &&
    tradedOn !== null &&
    Number.isFinite(unitsValue) &&
    unitsValue > 0 &&
    priceMicrodollars !== null &&
    !busy

  const buildInput = (): TradeInput => ({
    member_id: member.id,
    ticker: ticker.trim().toUpperCase(),
    side,
    traded_on: tradedOn!,
    units: unitsValue,
    price_per_unit_microdollars: priceMicrodollars!,
    fee_cents: dollarsToCents(fee) ?? 0,
  })
  const repeat = canSubmit && trades && findDuplicateTrade(trades, buildInput(), initial?.id)

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this trade. Please try again.',
    onSubmit,
    buildInput,
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial?.id)}
      addLabel="trade"
      submitLabel={submitLabel}
      cancelLabel={cancelLabel}
      onCancel={onCancel}
    >
      {attachment}
      {notice}
      {showFields && (
        <>
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
              description="Up to six decimal places."
              min={0}
              decimalScale={6}
              fixedDecimalScale={false}
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
          {repeat && (
            <Alert color="yellow" variant="light" p="xs">
              You already have a trade with this ticker, date, units, and price. Save it only if it
              is a separate trade.
            </Alert>
          )}
        </>
      )}
    </FormShell>
  )
}
