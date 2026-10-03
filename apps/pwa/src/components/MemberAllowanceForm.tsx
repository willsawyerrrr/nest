import { useState } from 'react'
import { NumberInput, Select } from '@mantine/core'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { MemberAllowance, MemberAllowanceInput } from '../hooks/useMemberAllowances'
import type { Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface MemberAllowanceFormProps {
  /** The member the allowance is for. */
  memberId: string
  /** The member's name, naming the form. */
  memberName: string
  /** The member's existing allowance, when editing. */
  initial?: MemberAllowance | undefined
  /** The household's accounts, offered as the allowance's funding account. */
  accounts?: { id: string; name: string }[]
  onSubmit: (input: MemberAllowanceInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational set/edit form for one member's spending allowance. Persistence lives in the caller. */
export function MemberAllowanceForm({
  memberId,
  memberName,
  initial,
  accounts = [],
  onSubmit,
  onCancel,
}: MemberAllowanceFormProps) {
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'fortnightly')
  const [interval, setInterval] = useState<number | string>(initial?.interval_count ?? '')
  const [accountId, setAccountId] = useState<string | null>(initial?.destination_account_id ?? null)
  const isEveryN = frequency === 'every_n_weeks' || frequency === 'every_n_months'
  const intervalUnit = frequency === 'every_n_months' ? 'months' : 'weeks'
  const intervalValid = Number.isInteger(Number(interval)) && Number(interval) >= 1
  const cents = dollarsToCents(amount)

  const canSubmit = cents !== null && cents > 0 && (!isEveryN || (interval !== '' && intervalValid))

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this allowance. Please try again.',
    onSubmit,
    buildInput: (): MemberAllowanceInput => ({
      member_id: memberId,
      amount_cents: cents ?? 0,
      frequency,
      interval_count: isEveryN ? Number(interval) : null,
      destination_account_id: accountId,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      submitLabel={initial ? 'Save changes' : 'Set allowance'}
      onCancel={onCancel}
    >
      <MoneyInput
        label={`${memberName}’s allowance`}
        size="sm"
        description="What they can spend on themselves. Items drawn from it count against it."
        min={0}
        hideControls
        value={amount}
        onChange={setAmount}
      />

      <EnumSelect
        label="Frequency"
        size="sm"
        data={FREQUENCY_OPTIONS}
        value={frequency}
        onChange={(value) => value && setFrequency(value)}
        allowDeselect={false}
      />

      {isEveryN && (
        <NumberInput
          label={`${intervalUnit === 'months' ? 'Months' : 'Weeks'} between allowances`}
          size="sm"
          description={`How many ${intervalUnit} apart each allowance lands (e.g. 4 for once every four ${intervalUnit}).`}
          min={1}
          step={1}
          allowDecimal={false}
          hideControls
          value={interval}
          onChange={setInterval}
        />
      )}

      <Select
        label="Funded from"
        size="sm"
        description="Optional. The account or synced saver whose pay split funds the allowance and what is drawn from it."
        placeholder="Not routed"
        data={accounts.map((account) => ({ value: account.id, label: account.name }))}
        value={accountId}
        onChange={setAccountId}
        clearable
        searchable
        nothingFoundMessage="No matching accounts"
      />
    </FormShell>
  )
}
