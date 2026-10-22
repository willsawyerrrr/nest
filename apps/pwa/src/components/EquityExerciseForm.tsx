import { useState } from 'react'
import { NumberInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { EquityExerciseInput, EquityExerciseRow } from '../hooks/useEquityExercises'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import type { EquitySaleRow } from '../hooks/useEquitySales'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { todayIso } from '../lib/dates'
import { exerciseError } from '../lib/equity'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface EquityExerciseFormProps {
  member: { id: string; name: string }
  /** The member's option grants an exercise can be recorded against. */
  grants: EquityGrantRow[]
  exercises: EquityExerciseRow[]
  sales: EquitySaleRow[]
  initial?: EquityExerciseRow | undefined
  onSubmit: (input: EquityExerciseInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for one exercise of options. Persistence lives in the caller. */
export function EquityExerciseForm({
  member,
  grants,
  exercises,
  sales,
  initial,
  onSubmit,
  onCancel,
}: EquityExerciseFormProps) {
  const [grantId, setGrantId] = useState<string | null>(initial?.grant_id ?? grants[0]?.id ?? null)
  const grant = grants.find((entry) => entry.id === grantId)
  const [exercisedOn, setExercisedOn] = useState<string | null>(initial?.exercised_on ?? todayIso())
  const [quantity, setQuantity] = useState<number | string>(initial?.quantity ?? '')
  const [strike, setStrike] = useState<number | string>(
    centsToDollars(initial?.strike_price_cents ?? grants[0]?.strike_price_cents ?? 0),
  )
  const [marketPrice, setMarketPrice] = useState<number | string>(
    centsToDollars(initial?.market_price_per_share_cents),
  )

  const units = typeof quantity === 'number' ? quantity : 0
  const limitError =
    grant && units > 0 ? exerciseError(grant, exercises, sales, units, initial?.id) : null
  const canSubmit =
    grant !== undefined &&
    exercisedOn !== null &&
    units > 0 &&
    dollarsToCents(strike) !== null &&
    limitError === null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this exercise. Please try again.',
    onSubmit,
    buildInput: (): EquityExerciseInput => ({
      member_id: member.id,
      grant_id: grant!.id,
      exercised_on: exercisedOn!,
      quantity: units,
      strike_price_cents: dollarsToCents(strike) ?? 0,
      market_price_per_share_cents: dollarsToCents(marketPrice),
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error ?? limitError}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="exercise"
      onCancel={onCancel}
    >
      <EnumSelect
        label="Grant"
        size="sm"
        data={grants.map((entry) => ({ value: entry.id, label: entry.label }))}
        value={grantId}
        onChange={(value) => {
          setGrantId(value)
          const next = grants.find((entry) => entry.id === value)
          if (next && !initial) {
            setStrike(centsToDollars(next.strike_price_cents ?? 0))
          }
        }}
        allowDeselect={false}
      />
      <DateInput
        label="Exercise date"
        size="sm"
        valueFormat="D MMM YYYY"
        value={exercisedOn}
        onChange={setExercisedOn}
      />
      <NumberInput
        label="Options exercised"
        size="sm"
        min={0}
        step={1}
        allowDecimal={false}
        hideControls
        value={quantity}
        onChange={setQuantity}
      />
      <MoneyInput
        label="Strike paid"
        size="sm"
        description="Per-share exercise price paid."
        min={0}
        hideControls
        value={strike}
        onChange={setStrike}
      />
      <MoneyInput
        label="Market price per share"
        size="sm"
        description="Optional. Value per share on the exercise date, for your records."
        min={0}
        hideControls
        value={marketPrice}
        onChange={setMarketPrice}
      />
    </FormShell>
  )
}
