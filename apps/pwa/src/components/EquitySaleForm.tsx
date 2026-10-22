import { useState } from 'react'
import { NumberInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { EquityExerciseRow } from '../hooks/useEquityExercises'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import type { EquitySaleInput, EquitySaleRow } from '../hooks/useEquitySales'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { todayIso } from '../lib/dates'
import { saleError } from '../lib/equity'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface EquitySaleFormProps {
  member: { id: string; name: string }
  /** The member's grants a sale can be recorded against. */
  grants: EquityGrantRow[]
  exercises: EquityExerciseRow[]
  sales: EquitySaleRow[]
  initial?: EquitySaleRow | undefined
  onSubmit: (input: EquitySaleInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for one sale of shares. Persistence lives in the caller. */
export function EquitySaleForm({
  member,
  grants,
  exercises,
  sales,
  initial,
  onSubmit,
  onCancel,
}: EquitySaleFormProps) {
  const [grantId, setGrantId] = useState<string | null>(initial?.grant_id ?? grants[0]?.id ?? null)
  const grant = grants.find((entry) => entry.id === grantId)
  const [soldOn, setSoldOn] = useState<string | null>(initial?.sold_on ?? todayIso())
  const [quantity, setQuantity] = useState<number | string>(initial?.quantity ?? '')
  const [price, setPrice] = useState<number | string>(
    centsToDollars(initial?.price_per_share_cents),
  )
  const [fee, setFee] = useState<number | string>(centsToDollars(initial?.fee_cents ?? 0))

  const units = typeof quantity === 'number' ? quantity : 0
  const limitError =
    grant && units > 0 ? saleError(grant, exercises, sales, units, initial?.id) : null
  const canSubmit =
    grant !== undefined &&
    soldOn !== null &&
    units > 0 &&
    dollarsToCents(price) !== null &&
    limitError === null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this sale. Please try again.',
    onSubmit,
    buildInput: (): EquitySaleInput => ({
      member_id: member.id,
      grant_id: grant!.id,
      sold_on: soldOn!,
      quantity: units,
      price_per_share_cents: dollarsToCents(price) ?? 0,
      fee_cents: dollarsToCents(fee) ?? 0,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error ?? limitError}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="sale"
      onCancel={onCancel}
    >
      <EnumSelect
        label="Grant"
        size="sm"
        data={grants.map((entry) => ({ value: entry.id, label: entry.label }))}
        value={grantId}
        onChange={setGrantId}
        allowDeselect={false}
      />
      <DateInput
        label="Sale date"
        size="sm"
        valueFormat="D MMM YYYY"
        value={soldOn}
        onChange={setSoldOn}
      />
      <NumberInput
        label="Shares sold"
        size="sm"
        min={0}
        step={1}
        allowDecimal={false}
        hideControls
        value={quantity}
        onChange={setQuantity}
      />
      <MoneyInput
        label="Price per share"
        size="sm"
        min={0}
        hideControls
        value={price}
        onChange={setPrice}
      />
      <MoneyInput
        label="Fees"
        size="sm"
        description="Brokerage and other costs of the sale."
        min={0}
        hideControls
        value={fee}
        onChange={setFee}
      />
    </FormShell>
  )
}
